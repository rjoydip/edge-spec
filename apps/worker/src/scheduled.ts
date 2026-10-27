/** Cron drift scans: compare a fresh snapshot with the stored one, then notify. */
import { classifyTree, parseOpenApiSpec } from "@edge-spec/core/scanner";
import { detectDrift, driftSummary, snapshotOf } from "@edge-spec/core/drift";
import { GitHub } from "@edge-spec/core/github";
import { InstallationTokenCache, gitHubAppFromEnv } from "@edge-spec/core/github-app";
import {
  getDriftSnapshot,
  getWorkspace,
  listScheduledRepos,
  markScheduledRun,
  purgeExpired,
  putDriftSnapshot,
  recordAudit,
  runsDb,
  syncBacklog,
  type ScheduledRepo,
  type Workspace,
} from "./db";
import type { D1Database, Env } from "./env";
import { deleteRunArtifacts } from "./artifacts";
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

async function scanRepo(
  env: Env,
  db: D1Database,
  schedule: ScheduledRepo,
  workspace: Workspace | undefined,
  now: number,
): Promise<void> {
  try {
    const app = gitHubAppFromEnv(env);
    const token =
      app && schedule.installationId
        ? await tokens.get(app, schedule.installationId, schedule.repo)
        : env.GH_TOKEN;
    if (!token) throw new Error("No GitHub credential for the scheduled scan.");
    const github = new GitHub(token);
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
    if (drift.changed) {
      const summary = driftSummary(schedule.repo, drift);
      if (env.ARTIFACTS) {
        await env.ARTIFACTS.put(
          `drift/${schedule.repo}/${now}.json`,
          JSON.stringify({ repo: schedule.repo, scannedAt: now, drift, summary }),
          { httpMetadata: { contentType: "application/json" } },
        ).catch(() => undefined);
      }
      // Store only after the announcement succeeds; a failed webhook retries.
      delivered = resolveDriftWebhook(env, schedule, workspace);
      if (delivered) await notify(delivered, schedule.repo, summary);
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
        notified: Boolean(delivered),
        webhookSource: delivered?.source ?? "none",
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

/** Runs due repositories; the cron fires daily and each repo has its interval. */
export async function runScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ScheduledContext,
): Promise<void> {
  const db = runsDb(env);
  if (!db) return;
  const now = controller.scheduledTime || Date.now();
  const workspace = await getWorkspace(db).catch(() => undefined);
  if (workspace) {
    // Retention runs daily, before the scans that would otherwise see stale rows.
    const purged = await purgeExpired(db, workspace.retentionDays, now).catch(() => undefined);
    if (purged) {
      const artifacts = await deleteRunArtifacts(env, purged.ids).catch(() => 0);
      await recordAudit(db, {
        actor: "cron",
        action: "retention_purge",
        detail: {
          retentionDays: workspace.retentionDays,
          runs: purged.runs,
          audit: purged.audit,
          artifacts,
        },
      }).catch(() => undefined);
    }
  }
  const due = (await listScheduledRepos(db)).filter(
    (schedule) =>
      schedule.enabled &&
      (schedule.lastRunAt === undefined ||
        now - schedule.lastRunAt >= schedule.intervalDays * 86_400_000),
  );
  for (const schedule of due.slice(0, 10)) {
    ctx.waitUntil(scanRepo(env, db, schedule, workspace, now));
  }
}
