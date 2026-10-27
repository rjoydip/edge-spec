/** Run history shapes and comparison. No storage, no HTTP, no secrets. */
import type { CheckResult, CoverageDelta, ScanTotals } from "./types";

export type RunStatus = "running" | "ready" | "failed";
export type RunDecision = "pending" | "accepted" | "rejected";

/** One run as the history list and the compare view need it. */
export interface RunSummary {
  id: string;
  repo: string;
  ref: string;
  status: RunStatus;
  provider: string;
  model: string;
  /** Epoch milliseconds. */
  startedAt: number;
  finishedAt?: number;
  totals: ScanTotals;
  /** Reserved for the cost feature; absent until a provider reports usage. */
  cost?: number;
}

/** A check without its output: history never retains test or source text. */
export type StoredCheck = Omit<CheckResult, "output">;

/** One test file a run produced, with its verification and decision. */
export interface RunFile {
  sourcePath: string;
  testPath: string;
  decision: RunDecision;
  verified: boolean;
  checks: StoredCheck[];
  coverage?: CoverageDelta;
}

export interface RunDetail {
  run: RunSummary;
  files: RunFile[];
}

const count = (files: readonly RunFile[], decision: RunDecision): number =>
  files.filter((file) => file.decision === decision).length;

/** Sum of the run's measured per-file deltas; unmeasured files contribute 0. */
function coveredDelta(files: readonly RunFile[]): number {
  return files.reduce(
    (sum, file) => sum + (file.coverage?.status === "measured" ? file.coverage.lines.delta : 0),
    0,
  );
}

export interface RunComparison {
  missing: { before: number; after: number; delta: number };
  files: { before: number; after: number };
  verified: { before: number; after: number };
  accepted: { before: number; after: number };
  rejected: { before: number; after: number };
  /** Files the newer run covered that the older one did not. */
  newFiles: string[];
  /** Files the older run covered that the newer one did not. */
  closedFiles: string[];
  /** Each run's own measured line delta, summed per file. */
  coverageLines: { before: number; after: number; delta: number };
}

/** Compares two completed runs of the same repository. */
export function compareRuns(before: RunDetail, after: RunDetail): RunComparison {
  const beforePaths = new Set(before.files.map((file) => file.sourcePath));
  const afterPaths = new Set(after.files.map((file) => file.sourcePath));
  const beforeCovered = coveredDelta(before.files);
  const afterCovered = coveredDelta(after.files);
  return {
    missing: {
      before: before.run.totals.missing,
      after: after.run.totals.missing,
      delta: after.run.totals.missing - before.run.totals.missing,
    },
    files: { before: before.files.length, after: after.files.length },
    verified: {
      before: before.files.filter((file) => file.verified).length,
      after: after.files.filter((file) => file.verified).length,
    },
    accepted: { before: count(before.files, "accepted"), after: count(after.files, "accepted") },
    rejected: { before: count(before.files, "rejected"), after: count(after.files, "rejected") },
    newFiles: [...afterPaths].filter((path) => !beforePaths.has(path)).sort(),
    closedFiles: [...beforePaths].filter((path) => !afterPaths.has(path)).sort(),
    coverageLines: {
      before: beforeCovered,
      after: afterCovered,
      delta: afterCovered - beforeCovered,
    },
  };
}
