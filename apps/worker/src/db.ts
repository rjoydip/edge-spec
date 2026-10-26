/** D1 queries for run history. Summaries only: no code, source, prompts or keys. */
import type {
  RunDecision,
  RunDetail,
  RunFile,
  RunStatus,
  RunSummary,
  StoredCheck,
} from "@edge-spec/core/history";
import type { DriftSnapshot } from "@edge-spec/core/drift";
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
