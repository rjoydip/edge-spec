/** The pull request payload: which test files a branch should carry. */
import { assertTestOnly } from "./policy";
import type { ProvenanceCheck, SkippedContractOperation } from "./provenance";
import type { CoverageDelta, MutationResult } from "./types";

/** One test file in the pull request, with the provenance the body needs. */
export interface PullFile {
  /** Path of the test file in the repository. */
  path: string;
  code: string;
  /** The source file the test covers. */
  sourcePath: string;
  provider?: string;
  model?: string;
  corrected?: boolean;
  promptVersion?: string;
  flaky?: boolean;
  verified?: boolean;
  checks?: ProvenanceCheck[];
  coverage?: CoverageDelta;
  mutation?: MutationResult;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/** Only the check facts a reviewer needs; command output is never retained. */
function checksOf(value: unknown): ProvenanceCheck[] {
  if (!Array.isArray(value)) return [];
  const checks: ProvenanceCheck[] = [];
  for (const entry of value.slice(0, 20)) {
    const item = record(entry);
    const name = text(item.name);
    const command = text(item.command);
    if (!name && !command) continue;
    const duration = Number(item.durationMs);
    checks.push({
      name,
      kind: text(item.kind) || "check",
      command,
      ok: item.ok === true,
      ...(item.skipped === true ? { skipped: true } : {}),
      durationMs: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : 0,
    });
  }
  return checks;
}

/** Accepts only a fully reported delta; anything else is left unmeasured. */
function coverageOf(value: unknown): CoverageDelta | undefined {
  const item = record(value);
  if (item.status !== "measured") return undefined;
  const lines = record(item.lines);
  const numbers = ["before", "after", "delta", "total"].map((key) => Number(lines[key]));
  if (numbers.some((number) => !Number.isFinite(number))) return undefined;
  const [before, after, delta, total] = numbers as [number, number, number, number];
  const branches = record(item.branches);
  const branchNumbers = ["before", "after", "delta", "total"].map((key) => Number(branches[key]));
  const measuredBranches =
    item.branches !== undefined && branchNumbers.every(Number.isFinite)
      ? {
          before: branchNumbers[0] as number,
          after: branchNumbers[1] as number,
          delta: branchNumbers[2] as number,
          total: branchNumbers[3] as number,
        }
      : undefined;
  return {
    status: "measured",
    path: text(item.path),
    lines: { before, after, delta, total },
    ...(measuredBranches ? { branches: measuredBranches } : {}),
  };
}

/** A mutation result is accepted only in one of its two declared shapes. */
function mutationOf(value: unknown): MutationResult | undefined {
  const item = record(value);
  const tool = text(item.tool) || "stryker";
  const command = text(item.command).slice(0, 500);
  if (item.status === "not-measured") {
    const reason = text(item.reason).slice(0, 300);
    return {
      status: "not-measured",
      tool,
      ...(command ? { command } : {}),
      ...(reason ? { reason } : {}),
    };
  }
  if (item.status !== "measured") return undefined;
  const killed = Number(item.killed);
  const survived = Number(item.survived);
  const total = Number(item.total);
  const score = Number(item.score);
  const durationMs = Number(item.durationMs);
  if (![killed, survived, total, score, durationMs].every(Number.isFinite)) return undefined;
  return {
    status: "measured",
    tool,
    command,
    killed,
    survived,
    total,
    score,
    durationMs,
    ...(item.budgetStopped === true ? { budgetStopped: true } : {}),
  };
}

function provenanceOf(item: Record<string, unknown>): Partial<PullFile> {
  const provider = text(item.provider).slice(0, 80);
  const model = text(item.model).slice(0, 120);
  const promptVersion = text(item.promptVersion).slice(0, 40);
  const checks = checksOf(item.checks);
  const coverage = coverageOf(item.coverage);
  const mutation = mutationOf(item.mutation);
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(promptVersion ? { promptVersion } : {}),
    ...(item.corrected === true ? { corrected: true } : {}),
    ...(item.flaky === true ? { flaky: true } : {}),
    ...(typeof item.verified === "boolean" ? { verified: item.verified } : {}),
    ...(checks.length > 0 ? { checks } : {}),
    ...(coverage ? { coverage } : {}),
    ...(mutation ? { mutation } : {}),
  };
}

/** The contract operations a client reports as skipped, with their reasons. */
export function pullSkippedOf(body: Record<string, unknown>): SkippedContractOperation[] {
  if (!Array.isArray(body.skipped)) return [];
  const skipped: SkippedContractOperation[] = [];
  for (const entry of body.skipped.slice(0, 50)) {
    const item = record(entry);
    const method = text(item.method).toUpperCase();
    const path = text(item.path);
    const reason = text(item.reason) || "not reported";
    if (!method || !path) continue;
    skipped.push({ method, path, reason: reason.slice(0, 200) });
  }
  return skipped;
}

/**
 * Accepts either a batch (`files`) or one test (`sourcePath`, `testPath`,
 * `code`). A batch becomes a single pull request, so every test lands on the
 * same branch and in the same commit.
 */
export function pullFilesOf(body: Record<string, unknown>): PullFile[] {
  const raw = Array.isArray(body.files) ? body.files : [];
  const files: PullFile[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const path = text(item.path);
    const code = text(item.code);
    if (!path || !code) continue;
    // The hard gate: a pull request may only carry test artifacts, whatever
    // the client generated or the reviewer edited.
    assertTestOnly(path);
    const sourcePath = text(item.sourcePath);
    files.push({
      path,
      code,
      sourcePath: sourcePath || path,
      ...provenanceOf(item),
    });
  }
  if (files.length > 0) return files;

  const sourcePath = text(body.sourcePath);
  const testPath = text(body.testPath);
  const code = text(body.code);
  if (sourcePath && testPath && code) {
    assertTestOnly(testPath);
    return [{ path: testPath, code, sourcePath, ...provenanceOf(body) }];
  }
  return [];
}

/** Optional copy the reviewer can edit before the pull request is opened. */
export interface PullMeta {
  title?: string;
  body?: string;
  branch?: string;
  commitMessage?: string;
  draft?: boolean;
}

/** Reads the optional pull request fields; absent values are omitted. */
export function pullMetaOf(body: Record<string, unknown>): PullMeta {
  const title = text(body.title).slice(0, 200);
  const prBody = text(body.body).slice(0, 20_000);
  const branch = text(body.branch).slice(0, 120);
  const commitMessage = text(body.commitMessage).slice(0, 200);
  return {
    ...(title ? { title } : {}),
    ...(prBody ? { body: prBody } : {}),
    ...(branch ? { branch } : {}),
    ...(commitMessage ? { commitMessage } : {}),
    ...(body.draft === true ? { draft: true } : {}),
  };
}

/** A user-edited branch must be a safe, non-protected git ref. */
export function validBranchName(value: string): boolean {
  if (!value || value.length > 120) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false;
  if (value.startsWith("-") || value.startsWith("/") || value.endsWith("/")) return false;
  if (value.endsWith(".") || value.endsWith(".lock")) return false;
  if (value.includes("..") || value.includes("//") || value.includes("@{") || value === "@") {
    return false;
  }
  if (value.startsWith("refs/")) return false;
  return !["main", "master", "HEAD"].includes(value);
}

/** A branch name fragment: the file name, safe for git. */
export function slugOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  return base.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase() || "tests";
}
