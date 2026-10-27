/**
 * Golden-repo harness. Compares local example scans with fixed expected gaps and
 * scores a supplied outcomes file. No AI is spent here, so it is safe to run in
 * CI and in tests.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  compareGolden,
  scoreRuns,
  type EvalOutcome,
  type EvalScore,
  type GoldenCase,
  type GoldenResult,
} from "../../packages/core/src/eval";
import { classifyTree } from "../../packages/core/src/scanner";

const SKIP = new Set([".git", "node_modules", "dist", "coverage", ".wrangler"]);

/** Every file under `directory`, relative and forward-slashed. */
export function filesUnder(directory: string, base = directory): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path, base));
    else files.push(relative(base, path).replace(/\\/g, "/"));
  }
  return files;
}

export function readGolden(path: string): GoldenCase[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { cases?: GoldenCase[] };
  return parsed.cases ?? [];
}

/** Runs every golden case against the examples in `root`. */
export function runGolden(root: string, cases: readonly GoldenCase[]): GoldenResult[] {
  return cases.map((testCase) => {
    const gaps = classifyTree(filesUnder(join(root, testCase.path))).missing.map((gap) => gap.path);
    return compareGolden(testCase.id, gaps, testCase.expectedGaps);
  });
}

/** Optional outcomes file; absent or unreadable means "nothing to score". */
export function readOutcomes(path: string): EvalOutcome[] | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as EvalOutcome[];
  } catch {
    return undefined;
  }
}

export function formatResult(result: GoldenResult, gaps: number): string {
  return (
    `${result.pass ? "pass" : "FAIL"} ${result.caseId}: ${gaps} gap(s)` +
    (result.missing.length ? ` · missing ${result.missing.join(", ")}` : "") +
    (result.unexpected.length ? ` · unexpected ${result.unexpected.join(", ")}` : "")
  );
}

export function formatScore(score: EvalScore): string {
  return (
    `${score.provider}/${score.model}: ${score.verifiedRate}% verified · ` +
    `${score.acceptanceRate}% accepted · ${score.flakeRate}% flaky` +
    (score.avgTokens !== undefined ? ` · ~${score.avgTokens} tokens/run` : "")
  );
}

export { scoreRuns };
