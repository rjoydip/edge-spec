import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  filesUnder,
  formatResult,
  formatScore,
  readGolden,
  readOutcomes,
  runGolden,
  scoreRuns,
} from "../harness";

const root = join(import.meta.dir, "..", "..");

describe("golden scans", () => {
  it("passes every golden case against the examples", () => {
    const cases = readGolden(join(import.meta.dir, "..", "golden.json"));
    expect(cases.map((testCase) => testCase.id)).toEqual(["mixed-gaps", "complete-app"]);
    const results = runGolden(root, cases);
    expect(results.every((result) => result.pass)).toBe(true);
    expect(results[0]).toMatchObject({ caseId: "mixed-gaps", missing: [], unexpected: [] });
  });

  it("ignores build and dependency folders when listing files", () => {
    const files = filesUnder(join(root, "examples", "complete-app"));
    expect(files).toContain("src/greeting.ts");
    expect(files.some((path) => path.startsWith("node_modules/"))).toBe(false);
  });

  it("reports a mismatch instead of silently passing", () => {
    const [result] = runGolden(root, [
      { id: "invented", path: "examples/complete-app", expectedGaps: ["src/gone.ts"] },
    ]);
    expect(result?.pass).toBe(false);
    expect(result?.missing).toEqual(["src/gone.ts"]);
    expect(result && formatResult(result, 0)).toContain("FAIL invented");
  });
});

describe("scoring", () => {
  it("returns undefined for a missing outcomes file", () => {
    expect(readOutcomes(join(import.meta.dir, "does-not-exist.json"))).toBeUndefined();
  });

  it("formats measured rates and omits unknown token counts", () => {
    const [score] = scoreRuns([
      {
        caseId: "mixed-gaps",
        provider: "workers-ai",
        model: "@cf/test",
        generated: 1,
        verified: 1,
        accepted: 1,
        flaky: 0,
        tokens: 120,
      },
    ]);
    expect(score).toBeDefined();
    if (!score) return;
    expect(formatScore(score)).toContain("100% verified");
    expect(formatScore(score)).toContain("100% accepted");
    expect(formatScore(score)).toContain("~120 tokens/run");

    const withoutTokens = formatScore({ ...score, avgTokens: undefined });
    expect(withoutTokens).not.toContain("tokens");
  });
});
