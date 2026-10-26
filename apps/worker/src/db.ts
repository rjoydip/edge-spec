/** D1 queries for run history. Summaries only: no code, source, prompts or keys. */
import type {
  RunDecision,
  RunDetail,
  RunFile,
  RunStatus,
  RunSummary,
  StoredCheck,
} from "@edge-spec/core/history";
import type { BacklogGap, BacklogItem, BacklogState } from "@edge-spec/core/backlog";
import type { DriftSnapshot } from "@edge-spec/core/drift";
import { parseRepoMemory, type RepoMemory } from "@edge-spec/core/memory";
import { parsePullPolicy, type PullPolicy } from "@edge-spec/core/policy";
import type { CoverageDelta, ScanTotals } from "@edge-spec/core/types";
import type { D1Database, Env } from "./env";

interface RunRow {
  id: string;
  repo: string;
  ref: string;
  status: string;
  provider: string;
  model: string;
  started_at: number;
  finished_at: number | null;
  totals_json: string;
  cost: number | null;
}

interface FileRow {
  run_id: string;
  source_path: string;
  test_path: string;
  decision: string;
  verified: number;
  checks_json: string;
  coverage_json: string | null;
}

const EMPTY_TOTALS: ScanTotals = { missing: 0, coverage: 0, api: 0, unsupported: 0, skipped: 0 };

/** The D1 binding, or `undefined` when history is not enabled. */
export function runsDb(env: Env): D1Database | undefined {
  return env.RUNS_DB;
}

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function statusOf(value: string): RunStatus {
  return value === "ready" || value === "failed" ? value : "running";
}

function decisionOf(value: string): RunDecision {
  return value === "accepted" || value === "rejected" ? value : "pending";
}

function summaryOf(row: RunRow): RunSummary {
  return {
    id: row.id,
    repo: row.repo,
    ref: row.ref,
    status: statusOf(row.status),
    provider: row.provider,
    model: row.model,
    startedAt: row.started_at,
    ...(row.finished_at !== null ? { finishedAt: row.finished_at } : {}),
    totals: json<ScanTotals>(row.totals_json, EMPTY_TOTALS),
    ...(row.cost !== null ? { cost: row.cost } : {}),
  };
}

function fileOf(row: FileRow): RunFile {
  const coverage = json<CoverageDelta | undefined>(row.coverage_json, undefined);
  return {
    sourcePath: row.source_path,
    testPath: row.test_path,
    decision: decisionOf(row.decision),
    verified: row.verified === 1,
    checks: json<StoredCheck[]>(row.checks_json, []),
    ...(coverage ? { coverage } : {}),
  };
}

const RUN_COLUMNS =
  "id, repo, ref, status, provider, model, started_at, finished_at, totals_json, cost";
const FILE_COLUMNS =
  "run_id, source_path, test_path, decision, verified, checks_json, coverage_json";

export async function createRun(db: D1Database, run: RunSummary): Promise<void> {
  await db
    .prepare(`INSERT INTO runs (${RUN_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      run.id,
      run.repo,
      run.ref,
      run.status,
      run.provider,
      run.model,
      run.startedAt,
      run.finishedAt ?? null,
      JSON.stringify(run.totals),
      run.cost ?? null,
    )
    .run();
}

/** Updates the summary and writes one row per generated test in one batch. */
export async function finishRun(
  db: D1Database,
  run: RunSummary,
  files: readonly RunFile[],
): Promise<void> {
  const statements = [
    db
      .prepare("UPDATE runs SET status = ?, finished_at = ?, totals_json = ? WHERE id = ?")
      .bind(run.status, run.finishedAt ?? Date.now(), JSON.stringify(run.totals), run.id),
    ...files.map((file) =>
      db
        .prepare(`INSERT OR REPLACE INTO run_files (${FILE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          run.id,
          file.sourcePath,
          file.testPath,
          file.decision,
          file.verified ? 1 : 0,
          JSON.stringify(file.checks),
          file.coverage ? JSON.stringify(file.coverage) : null,
        ),
    ),
  ];
  await db.batch(statements);
}

export async function listRuns(db: D1Database, repo: string, limit = 20): Promise<RunSummary[]> {
  const requested = Number.isFinite(limit) ? limit : 20;
  const capped = Math.min(50, Math.max(1, Math.round(requested)));
  const result = await db
    .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE repo = ? ORDER BY started_at DESC LIMIT ?`)
    .bind(repo, capped)
    .all<RunRow>();
  return (result.results ?? []).map(summaryOf);
}

export async function getRun(db: D1Database, id: string): Promise<RunDetail | undefined> {
  const row = await db
    .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`)
    .bind(id)
    .first<RunRow>();
  if (!row) return undefined;
  const result = await db
    .prepare(`SELECT ${FILE_COLUMNS} FROM run_files WHERE run_id = ? ORDER BY source_path`)
    .bind(id)
    .all<FileRow>();
  return { run: summaryOf(row), files: (result.results ?? []).map(fileOf) };
}

/** Deletes every run for one repository and returns how many runs went. */
export async function deleteRunHistory(db: D1Database, repo: string): Promise<number> {
  const count = await db
    .prepare("SELECT COUNT(*) AS count FROM runs WHERE repo = ?")
    .bind(repo)
    .first<{ count: number }>();
  await db.batch([
    db
      .prepare("DELETE FROM run_files WHERE run_id IN (SELECT id FROM runs WHERE repo = ?)")
      .bind(repo),
    db.prepare("DELETE FROM runs WHERE repo = ?").bind(repo),
  ]);
  return Number(count?.count ?? 0);
}

export async function getMemory(db: D1Database, repo: string): Promise<RepoMemory> {
  const row = await db
    .prepare("SELECT memory_json FROM repo_memory WHERE repo = ?")
    .bind(repo)
    .first<{ memory_json: string }>();
  return row ? parseRepoMemory(json(row.memory_json, {})) : {};
}

export async function putMemory(
  db: D1Database,
  repo: string,
  memory: RepoMemory,
): Promise<RepoMemory> {
  const parsed = parseRepoMemory(memory);
  await db
    .prepare("INSERT OR REPLACE INTO repo_memory (repo, memory_json, updated_at) VALUES (?, ?, ?)")
    .bind(repo, JSON.stringify(parsed), Date.now())
    .run();
  return parsed;
}

export async function deleteMemory(db: D1Database, repo: string): Promise<void> {
  await db.prepare("DELETE FROM repo_memory WHERE repo = ?").bind(repo).run();
}

/** The opt-in CI policy for one repository; absent means no gates. */
export async function getPolicy(db: D1Database, repo: string): Promise<PullPolicy> {
  const row = await db
    .prepare("SELECT policy_json FROM policies WHERE repo = ?")
    .bind(repo)
    .first<{ policy_json: string }>();
  return row ? parsePullPolicy(json(row.policy_json, {})) : {};
}

export async function putPolicy(
  db: D1Database,
  repo: string,
  policy: PullPolicy,
): Promise<PullPolicy> {
  const parsed = parsePullPolicy(policy);
  await db
    .prepare("INSERT OR REPLACE INTO policies (repo, policy_json, updated_at) VALUES (?, ?, ?)")
    .bind(repo, JSON.stringify(parsed), Date.now())
    .run();
  return parsed;
}

export async function deletePolicy(db: D1Database, repo: string): Promise<void> {
  await db.prepare("DELETE FROM policies WHERE repo = ?").bind(repo).run();
}

/**
 * One command per user/PR/command per window. The row is small and old rows
 * are harmless; there is no unbounded event log here.
 */
export async function claimPrCommand(
  db: D1Database,
  repo: string,
  pull: number,
  login: string,
  command: string,
  windowMs = 60_000,
  now = Date.now(),
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT started_at FROM pr_commands WHERE repo = ? AND pull = ? AND login = ? AND command = ?",
    )
    .bind(repo, pull, login, command)
    .first<{ started_at: number }>();
  if (row && now - row.started_at < windowMs) return false;
  await db
    .prepare(
      "INSERT OR REPLACE INTO pr_commands (repo, pull, login, command, started_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(repo, pull, login, command, now)
    .run();
  return true;
}

interface BacklogRow {
  repo: string;
  path: string;
  kind: string;
  state: string;
  owner: string | null;
  risk: string | null;
  reason: string | null;
  first_seen: number;
  last_seen: number;
  closed_at: number | null;
  last_run_id: string | null;
}

const BACKLOG_STATES: ReadonlySet<string> = new Set([
  "open",
  "accepted",
  "rejected",
  "ignored",
  "closed",
]);

function backlogOf(row: BacklogRow): BacklogItem {
  return {
    repo: row.repo,
    path: row.path,
    kind: row.kind,
    state: (BACKLOG_STATES.has(row.state) ? row.state : "open") as BacklogState,
    ...(row.owner !== null ? { owner: row.owner } : {}),
    ...(row.risk !== null ? { risk: row.risk } : {}),
    ...(row.reason !== null ? { reason: row.reason } : {}),
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    ...(row.closed_at !== null ? { closedAt: row.closed_at } : {}),
    ...(row.last_run_id !== null ? { lastRunId: row.last_run_id } : {}),
  };
}

export async function listBacklog(db: D1Database, repo: string): Promise<BacklogItem[]> {
  const result = await db
    .prepare(
      "SELECT repo, path, kind, state, owner, risk, reason, first_seen, last_seen, closed_at, last_run_id FROM backlog_items WHERE repo = ? ORDER BY last_seen DESC, path",
    )
    .bind(repo)
    .all<BacklogRow>();
  return (result.results ?? []).map(backlogOf);
}

/**
 * Upserts the gaps a scan found and closes the ones that disappeared.
 * Accepted/rejected/ignored states survive; a returning closed item reopens.
 */
export async function syncBacklog(
  db: D1Database,
  repo: string,
  gaps: readonly BacklogGap[],
  now = Date.now(),
  runId?: string,
  /** Only these kinds may be closed by this scan. Omit to close every kind. */
  closeKinds?: readonly string[],
): Promise<void> {
  const rows = await db
    .prepare("SELECT path, kind, state FROM backlog_items WHERE repo = ?")
    .bind(repo)
    .all<{ path: string; kind: string; state: string }>();
  const previous = new Map(
    (rows.results ?? []).map((row) => [row.path, { kind: row.kind, state: row.state }]),
  );
  const current = new Set(gaps.map((gap) => gap.path));
  const statements = gaps.map((gap) =>
    previous.has(gap.path)
      ? db
          .prepare(
            `UPDATE backlog_items SET
               kind = ?, owner = COALESCE(?, owner), risk = ?, reason = ?,
               last_seen = ?,
               state = CASE WHEN state = 'closed' THEN 'open' ELSE state END,
               closed_at = NULL,
               last_run_id = COALESCE(?, last_run_id)
             WHERE repo = ? AND path = ?`,
          )
          .bind(
            gap.kind,
            gap.owner ?? null,
            gap.risk ?? null,
            gap.reason ?? null,
            now,
            runId ?? null,
            repo,
            gap.path,
          )
      : db
          .prepare(
            `INSERT INTO backlog_items
               (repo, path, kind, state, owner, risk, reason, first_seen, last_seen, closed_at, last_run_id)
             VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, NULL, ?)`,
          )
          .bind(
            repo,
            gap.path,
            gap.kind,
            gap.owner ?? null,
            gap.risk ?? null,
            gap.reason ?? null,
            now,
            now,
            runId ?? null,
          ),
  );
  for (const [path, row] of previous) {
    if (current.has(path) || row.state === "closed") continue;
    if (closeKinds && !closeKinds.includes(row.kind)) continue;
    statements.push(
      db
        .prepare(
          "UPDATE backlog_items SET state = 'closed', closed_at = ?, last_seen = ? WHERE repo = ? AND path = ?",
        )
        .bind(now, now, repo, path),
    );
  }
  if (statements.length > 0) await db.batch(statements);
}

export async function setBacklogState(
  db: D1Database,
  repo: string,
  path: string,
  state: BacklogState,
  owner?: string,
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(
      "UPDATE backlog_items SET state = ?, owner = COALESCE(?, owner), closed_at = ? WHERE repo = ? AND path = ?",
    )
    .bind(state, owner ?? null, state === "closed" ? now : null, repo, path)
    .run();
}

export interface Workspace {
  id: string;
  name: string;
  /** Days to keep runs, audit events and command rate-limit rows. */
  retentionDays: number;
  createdAt: number;
  updatedAt: number;
}

export interface AuditEvent {
  id?: number;
  repo?: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: number;
}

const SECRET_KEY = /token|key|secret|password|authorization|cookie/i;

/** Audit detail is structural only; secret-looking keys are removed. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) continue;
      result[key] = redact(item, depth + 1);
    }
    return result;
  }
  return undefined;
}

export async function getWorkspace(db: D1Database, id = "default"): Promise<Workspace> {
  const row = await db
    .prepare("SELECT id, name, retention_days, created_at, updated_at FROM workspaces WHERE id = ?")
    .bind(id)
    .first<{
      id: string;
      name: string;
      retention_days: number;
      created_at: number;
      updated_at: number;
    }>();
  if (row) {
    return {
      id: row.id,
      name: row.name,
      retentionDays: row.retention_days,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO workspaces (id, name, retention_days, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, "Default workspace", 30, now, now)
    .run();
  return {
    id,
    name: "Default workspace",
    retentionDays: 30,
    createdAt: now,
    updatedAt: now,
  };
}

export async function putWorkspace(
  db: D1Database,
  input: { name?: string; retentionDays?: number },
  id = "default",
): Promise<Workspace> {
  const current = await getWorkspace(db, id);
  const name = input.name?.trim().slice(0, 100) || current.name;
  const days = Number(input.retentionDays);
  const retentionDays = Number.isFinite(days)
    ? Math.min(365, Math.max(1, Math.round(days)))
    : current.retentionDays;
  const updatedAt = Date.now();
  await db
    .prepare("UPDATE workspaces SET name = ?, retention_days = ?, updated_at = ? WHERE id = ?")
    .bind(name, retentionDays, updatedAt, id)
    .run();
  return { ...current, name, retentionDays, updatedAt };
}

export async function recordAudit(
  db: D1Database,
  event: {
    actor: string;
    action: string;
    repo?: string;
    detail?: Record<string, unknown>;
    workspaceId?: string;
  },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO audit_events (workspace_id, repo, actor, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      event.workspaceId ?? "default",
      event.repo ?? null,
      event.actor.slice(0, 120),
      event.action.slice(0, 120),
      JSON.stringify(redact(event.detail ?? {})),
      Date.now(),
    )
    .run();
}

export async function listAudit(
  db: D1Database,
  input: { repo?: string; limit?: number } = {},
): Promise<AuditEvent[]> {
  const limit = Math.min(200, Math.max(1, Math.round(input.limit ?? 100)));
  const rows = input.repo
    ? await db
        .prepare(
          "SELECT id, repo, actor, action, detail_json, created_at FROM audit_events WHERE repo = ? ORDER BY created_at DESC, id DESC LIMIT ?",
        )
        .bind(input.repo, limit)
        .all<{
          id: number;
          repo: string | null;
          actor: string;
          action: string;
          detail_json: string;
          created_at: number;
        }>()
    : await db
        .prepare(
          "SELECT id, repo, actor, action, detail_json, created_at FROM audit_events ORDER BY created_at DESC, id DESC LIMIT ?",
        )
        .bind(limit)
        .all<{
          id: number;
          repo: string | null;
          actor: string;
          action: string;
          detail_json: string;
          created_at: number;
        }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    ...(row.repo ? { repo: row.repo } : {}),
    actor: row.actor,
    action: row.action,
    detail: json<Record<string, unknown>>(row.detail_json, {}),
    createdAt: row.created_at,
  }));
}

/** Deletes runs, their files, audit events and stale command rows past retention. */
export async function purgeExpired(
  db: D1Database,
  retentionDays: number,
  now = Date.now(),
): Promise<{ runs: number; audit: number; ids: string[] }> {
  const cutoff = now - Math.max(1, Math.round(retentionDays)) * 86_400_000;
  const expired =
    (
      await db
        .prepare("SELECT id FROM runs WHERE started_at < ?")
        .bind(cutoff)
        .all<{ id: string }>()
    ).results ?? [];
  const runs = expired.length;
  const audit =
    (
      await db
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE created_at < ?")
        .bind(cutoff)
        .first<{ count: number }>()
    )?.count ?? 0;
  await db.batch([
    db
      .prepare("DELETE FROM run_files WHERE run_id IN (SELECT id FROM runs WHERE started_at < ?)")
      .bind(cutoff),
    db.prepare("DELETE FROM runs WHERE started_at < ?").bind(cutoff),
    db.prepare("DELETE FROM audit_events WHERE created_at < ?").bind(cutoff),
    db.prepare("DELETE FROM pr_commands WHERE started_at < ?").bind(cutoff),
  ]);
  return { runs, audit, ids: expired.map((row) => row.id) };
}

export interface ScheduledRepo {
  repo: string;
  intervalDays: number;
  enabled: boolean;
  installationId?: number;
  lastRunAt?: number;
}

interface ScheduleRow {
  repo: string;
  interval_days: number;
  enabled: number;
  installation_id: number | null;
  last_run_at: number | null;
}

function scheduleOf(row: ScheduleRow): ScheduledRepo {
  return {
    repo: row.repo,
    intervalDays: row.interval_days,
    enabled: row.enabled === 1,
    ...(row.installation_id !== null ? { installationId: row.installation_id } : {}),
    ...(row.last_run_at !== null ? { lastRunAt: row.last_run_at } : {}),
  };
}

export async function listScheduledRepos(db: D1Database): Promise<ScheduledRepo[]> {
  const result = await db
    .prepare(
      "SELECT repo, interval_days, enabled, installation_id, last_run_at FROM scheduled_repos ORDER BY repo",
    )
    .all<ScheduleRow>();
  return (result.results ?? []).map(scheduleOf);
}

export async function putScheduledRepo(
  db: D1Database,
  input: { repo: string; intervalDays: number; enabled: boolean; installationId?: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO scheduled_repos (repo, interval_days, enabled, installation_id, last_run_at)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(repo) DO UPDATE SET
         interval_days = excluded.interval_days,
         enabled = excluded.enabled,
         installation_id = excluded.installation_id`,
    )
    .bind(input.repo, input.intervalDays, input.enabled ? 1 : 0, input.installationId ?? null)
    .run();
}

export async function deleteScheduledRepo(db: D1Database, repo: string): Promise<void> {
  await db.prepare("DELETE FROM scheduled_repos WHERE repo = ?").bind(repo).run();
}

export async function getDriftSnapshot(
  db: D1Database,
  repo: string,
): Promise<DriftSnapshot | undefined> {
  const row = await db
    .prepare("SELECT missing_json, operations_json FROM drift_snapshots WHERE repo = ?")
    .bind(repo)
    .first<{ missing_json: string; operations_json: string }>();
  if (!row) return undefined;
  const missing = json<unknown>(row.missing_json, []);
  const operations = json<unknown>(row.operations_json, []);
  return {
    missing: Array.isArray(missing)
      ? missing.filter((item): item is string => typeof item === "string")
      : [],
    operations: Array.isArray(operations)
      ? operations.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export async function putDriftSnapshot(
  db: D1Database,
  repo: string,
  snapshot: DriftSnapshot,
  scannedAt = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO drift_snapshots (repo, missing_json, operations_json, scanned_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(repo) DO UPDATE SET
         missing_json = excluded.missing_json,
         operations_json = excluded.operations_json,
         scanned_at = excluded.scanned_at`,
    )
    .bind(repo, JSON.stringify(snapshot.missing), JSON.stringify(snapshot.operations), scannedAt)
    .run();
}

export async function markScheduledRun(
  db: D1Database,
  repo: string,
  at = Date.now(),
): Promise<void> {
  await db
    .prepare("UPDATE scheduled_repos SET last_run_at = ? WHERE repo = ?")
    .bind(at, repo)
    .run();
}

/** Records the reviewer's decisions for files in one run. */
export async function setRunDecisions(
  db: D1Database,
  runId: string,
  decisions: readonly { sourcePath: string; decision: RunDecision }[],
): Promise<void> {
  if (decisions.length === 0) return;
  await db.batch(
    decisions.map((item) =>
      db
        .prepare("UPDATE run_files SET decision = ? WHERE run_id = ? AND source_path = ?")
        .bind(item.decision, runId, item.sourcePath),
    ),
  );
}
