import { describe, expect, it } from "bun:test";
import { compareGolden, scoreRuns, type EvalOutcome } from "../src/eval";

describe("compareGolden", () => {
  it("passes only when the gap sets match", () => {
    expect(compareGolden("a", ["src/b.ts", "src/a.ts"], ["src/a.ts", "src/b.ts"]).pass).toBe(true);
    expect(compareGolden("a", ["src/a.ts"], ["src/a.ts", "src/b.ts"])).toMatchObject({
      pass: false,
      missing: ["src/b.ts"],
    });
    expect(compareGolden("a", ["src/c.ts"], [])).toMatchObject({
      pass: false,
      unexpected: ["src/c.ts"],
    });
  });
});

describe("scoreRuns", () => {
  const outcomes: EvalOutcome[] = [
    {
      caseId: "a",
      provider: "openai",
      model: "gpt-6-luna",
      generated: 10,
      verified: 8,
      accepted: 6,
      flaky: 1,
      tokens: 1000,
    },
    {
      caseId: "b",
      provider: "openai",
      model: "gpt-6-luna",
      generated: 10,
      verified: 9,
      accepted: 7,
      flaky: 0,
      tokens: 2000,
    },
    {
      caseId: "a",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      generated: 10,
      verified: 5,
      accepted: 4,
      flaky: 2,
    },
  ];

  it("groups by provider/model and reports measured rates", () => {
    const scores = scoreRuns(outcomes);
    expect(scores[0]).toMatchObject({
      provider: "openai",
      model: "gpt-6-luna",
      runs: 2,
      generated: 20,
      verifiedRate: 85,
      acceptanceRate: 65,
      flakeRate: 5,
      avgTokens: 1500,
    });
    expect(scores[1]).toMatchObject({
      provider: "anthropic",
      verifiedRate: 50,
      acceptanceRate: 40,
      flakeRate: 20,
    });
    expect(scores[1]?.avgTokens).toBeUndefined();
  });
});
