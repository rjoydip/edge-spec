/**
 * Golden-repo harness entry point.
 *
 *   bun run eval
 *
 * Compares local example scans with fixed expected gaps, then optionally scores
 * `evals/outcomes.json`. No AI is spent here.
 */
import { join } from "node:path";
import {
  formatResult,
  formatScore,
  readGolden,
  readOutcomes,
  runGolden,
  scoreRuns,
} from "./harness";

const root = join(import.meta.dir, "..", "..");
const cases = readGolden(join(import.meta.dir, "..", "golden.json"));

let failed = 0;
for (const testCase of cases) {
  const result = runGolden(root, [testCase])[0];
  if (!result) continue;
  if (!result.pass) failed += 1;
  const gaps = testCase.expectedGaps.length + result.unexpected.length - result.missing.length;
  console.log(formatResult(result, gaps));
}

const outcomes = readOutcomes(join(import.meta.dir, "..", "outcomes.json"));
if (outcomes) for (const score of scoreRuns(outcomes)) console.log(formatScore(score));

if (failed > 0) process.exit(1);
