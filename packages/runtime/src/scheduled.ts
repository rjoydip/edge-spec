/** Cron drift scans: compare a fresh snapshot with the stored one, then notify. */
import { classifyTree, parseOpenApiSpec } from "@edge-spec/core/scanner";
import { detectDrift, driftSummary, snapshotOf } from "@edge-spec/core/drift";
import { GitHub } from "@edge-spec/core/github";
import { InstallationTokenCache, gitHubAppFromEnv } from "@edge-spec/core/github-app";
import {
  getDriftSnapshot,
  listScheduledRepos,
  markScheduledRun,
  purgeExpired,
  putDriftSnapshot,
  recordAudit,
  runsDb,
  syncBacklog,
  type ScheduledRepo,
} from "./db";
import type { Env, SqlDatabase } from "./env";
import { deleteRunArtifacts, purgeDriftArtifacts } from "./artifacts";
import { emailConfigOf, sendEmail } from "./email";
import { ownerLookup } from "./ownership";
import { resolveDriftWebhook, type DriftWebhookTarget } from "./drift-webhook";

export interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

export interface ScheduledContext {
  waitUntil(promise: Promise<unknown>): void;
}

const tokens = new InstallationTokenCache();
const OPENAPI_LIKE = /(^|\/)(openapi|swagger|api[-_.]?spec)[^/]*\.(json|ya?ml)$/i;
/** Fixed retention window: runs, audit events and command rows. */
const RETENTION_DAYS = 30;

async function operationsOf(
  github: GitHub,
  repo: string,
  ref: string,
  blobs: readonly string[],
): Promise<string[]> {
  const operations: string[] = [];
  for (const path of blobs.filter((item) => OPENAPI_LIKE.test(item)).slice(0, 4)) {
    try {
      const spec = parseOpenApiSpec(await github.file(repo, path, ref), path);
      if (!spec) continue;
      for (const endpoint of spec.endpoints) {
        operations.push(`${endpoint.method.toUpperCase()} ${endpoint.path}`);
      }
    } catch {
      // A spec we cannot read is a spec we cannot compare.
    }
  }
  return operations;
}

async function notify(target: DriftWebhookTarget, repo: string, summary: string): Promise<void> {
  const response = await fetch(target.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(target.secret ? { "x-edgespec-secret": target.secret } : {}),
    },
    body: JSON.stringify({ text: summary, repo }),
  });
  if (!response.ok) {
    throw new Error(`Drift webhook returned ${response.status}.`);
  }
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sends the summary to DRIFT_ALERT_EMAIL when no webhook is configured. */
async function notifyEmail(env: Env, repo: string, summary: string): Promise<boolean> {
  const to = env.DRIFT_ALERT_EMAIL?.trim();
  const config = emailConfigOf(env);
  if (!to || !config) return false;
  const result = await sendEmail(config, {
    to,
    subject: `EdgeSpec drift: ${repo}`,
    text: summary,
    html: `<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:13px;">${escapeHtml(summary)}</pre>`,
  });
  if (!result.sent) throw new Error(result.reason);
  return true;
}

async function scanRepo(
  env: Env,
  db: SqlDatabase,
  schedule: ScheduledRepo,
  now: number,
  injected?: GitHub,
): Promise<void> {
  try {
    const app = gitHubAppFromEnv(env);
    const token = injected
      ? undefined
      : app && schedule.installationId
        ? await tokens.get(app, schedule.installationId, schedule.repo)
        : env.GH_TOKEN;
    if (!injected && !token) throw new Error("No GitHub credential for the scheduled scan.");
    const github = injected ?? new GitHub(token!);
    const base = await github.defaultBranch(schedule.repo);
    const tree = await github.tree(schedule.repo, base);
    const blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
    const classification = classifyTree(blobs);
    const current = snapshotOf({
      missing: classification.missing.map((gap) => gap.path),
      operations: await operationsOf(github, schedule.repo, base, blobs),
    });
    const owner = await ownerLookup(github, schedule.repo, base, blobs);
    const previous = await getDriftSnapshot(db, schedule.repo);
    const drift = detectDrift(previous, current);

    let delivered: DriftWebhookTarget | undefined;
    let emailed = false;
    if (drift.changed) {
      const summary = driftSummary(schedule.repo, drift);
      if (env.ARTIFACTS) {
        await env.ARTIFACTS.put(
          `drift/${schedule.repo}/${now}.json`,
          JSON.stringify({
            repo: schedule.repo,
            scannedAt: now,
            drift,
            summary,
          }),
          { httpMetadata: { contentType: "application/json" } },
        ).catch(() => undefined);
      }
      // Store only after the announcement succeeds; a failed webhook retries.
      delivered = resolveDriftWebhook(env, schedule);
      if (delivered) await notify(delivered, schedule.repo, summary);
      else emailed = await notifyEmail(env, schedule.repo, summary);
    }
    await syncBacklog(
      db,
      schedule.repo,
      classification.missing.map((gap) => {
        const ownerName = owner(gap.path);
        return {
          path: gap.path,
          kind: "missing",
          ...(ownerName ? { owner: ownerName } : {}),
          risk: gap.risk,
          reason: gap.reason,
        };
      }),
      Date.now(),
      undefined,
      ["missing"],
    );
    await putDriftSnapshot(db, schedule.repo, current, now);
    await markScheduledRun(db, schedule.repo, now);
    await recordAudit(db, {
      repo: schedule.repo,
      actor: "cron",
      action: "drift_scan",
      detail: {
        changed: drift.changed,
        notified: Boolean(delivered) || emailed,
        webhookSource: delivered?.source ?? "none",
        email: emailed,
        newFiles: drift.newFiles.length,
        closedFiles: drift.closedFiles.length,
        apiAdded: drift.apiAdded.length,
        apiRemoved: drift.apiRemoved.length,
        gaps: current.missing.length,
      },
    }).catch(() => undefined);
  } catch (error) {
    // One repository must not stop the rest of the schedule.
    console.error(
      `scheduled drift failed for ${schedule.repo}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Injectable seams for tests; production leaves both unset. */
export interface ScheduledDeps {
  github?: GitHub;
}

/** Runs due repositories; the cron fires daily and each repo has its interval. */
export async function runScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ScheduledContext,
  deps: ScheduledDeps = {},
): Promise<void> {
  const db = runsDb(env);
  if (!db) return;
  const now = controller.scheduledTime || Date.now();
  // Retention runs daily, before the scans that would otherwise see stale rows.
  const purged = await purgeExpired(db, RETENTION_DAYS, now).catch(() => undefined);
  if (purged) {
    const artifacts = await deleteRunArtifacts(env, purged.ids).catch(() => 0);
    const drift = await purgeDriftArtifacts(env, RETENTION_DAYS, now).catch(() => 0);
    await recordAudit(db, {
      actor: "cron",
      action: "retention_purge",
      detail: {
        retentionDays: RETENTION_DAYS,
        runs: purged.runs,
        audit: purged.audit,
        artifacts,
        drift,
      },
    }).catch(() => undefined);
  }
  const due = (await listScheduledRepos(db)).filter(
    (schedule) =>
      schedule.enabled &&
      (schedule.lastRunAt === undefined ||
        now - schedule.lastRunAt >= schedule.intervalDays * 86_400_000),
  );
  for (const schedule of due.slice(0, 10)) {
    ctx.waitUntil(scanRepo(env, db, schedule, now, deps.github));
  }
}
