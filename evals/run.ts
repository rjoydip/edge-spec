/**
 * Golden-repo harness. Compares local example scans with fixed expected gaps,
 * then optionally scores a supplied outcomes file. No AI is spent here.
 *
 *   bun run eval
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  compareGolden,
  scoreRuns,
  type EvalOutcome,
  type GoldenCase,
} from "../packages/core/src/eval";
import { classifyTree } from "../packages/core/src/scanner";

const SKIP = new Set([".git", "node_modules", "dist", "coverage", ".wrangler"]);
const root = join(import.meta.dir, "..");

function filesUnder(directory: string, base = directory): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path, base));
    else files.push(relative(base, path).replace(/\\/g, "/"));
  }
  return files;
}

const golden = JSON.parse(readFileSync(join(import.meta.dir, "golden.json"), "utf8")) as {
  cases: GoldenCase[];
};

let failed = 0;
for (const testCase of golden.cases) {
  const paths = filesUnder(join(root, testCase.path));
  const gaps = classifyTree(paths).missing.map((gap) => gap.path);
  const result = compareGolden(testCase.id, gaps, testCase.expectedGaps);
  if (!result.pass) failed += 1;
  console.log(
    `${result.pass ? "pass" : "FAIL"} ${result.caseId}: ${gaps.length} gap(s)` +
      (result.missing.length ? ` · missing ${result.missing.join(", ")}` : "") +
      (result.unexpected.length ? ` · unexpected ${result.unexpected.join(", ")}` : ""),
  );
}

try {
  const outcomes = JSON.parse(
    readFileSync(join(import.meta.dir, "outcomes.json"), "utf8"),
  ) as EvalOutcome[];
  for (const score of scoreRuns(outcomes)) {
    console.log(
      `${score.provider}/${score.model}: ${score.verifiedRate}% verified · ` +
        `${score.acceptanceRate}% accepted · ${score.flakeRate}% flaky` +
        (score.avgTokens !== undefined ? ` · ~${score.avgTokens} tokens/run` : ""),
    );
  }
} catch {
  // An outcomes file is optional; the harness runs without one.
}

if (failed > 0) process.exit(1);
