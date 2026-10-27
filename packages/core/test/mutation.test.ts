import { describe, expect, it } from "bun:test";
import { mutationCommandFor, parseMutationReport } from "../src/mutation";

const STRYKER = JSON.stringify({
  files: {
    "src/a.ts": {
      mutants: [
        { status: "Killed" },
        { status: "Killed" },
        { status: "Survived" },
        { status: "NoCoverage" },
        { status: "Ignored" },
        { status: "CompileError" },
      ],
    },
  },
});

describe("mutationCommandFor", () => {
  it("substitutes and shell-quotes the file and test", () => {
    expect(
      mutationCommandFor(
        "npx stryker run --mutate {file} --test {test}",
        "src/a.ts",
        "src/a.test.ts",
      ),
    ).toBe("npx stryker run --mutate 'src/a.ts' --test 'src/a.test.ts'");
    expect(mutationCommandFor("npx stryker run", "a", "b")).toBe("npx stryker run");
  });
});

describe("parseMutationReport", () => {
  it("counts killed and survived, ignoring invalid mutants", () => {
    expect(parseMutationReport(STRYKER, "npx stryker run", 1200)).toEqual({
      status: "measured",
      tool: "stryker",
      command: "npx stryker run",
      killed: 2,
      survived: 2,
      total: 4,
      score: 50,
      durationMs: 1200,
    });
  });

  it("labels a budget stop without inventing a score", () => {
    const report = parseMutationReport(STRYKER, "npx stryker run", 10, {
      budgetStopped: true,
    });
    expect(report).toMatchObject({
      status: "measured",
      budgetStopped: true,
      score: 50,
    });
  });

  it("reads root killed/survived totals and a reported score", () => {
    const report = parseMutationReport(
      JSON.stringify({ killed: 8, survived: 2, mutationScore: 80 }),
      "tool",
      5,
    );
    expect(report).toMatchObject({
      status: "measured",
      killed: 8,
      survived: 2,
      score: 80,
    });
  });

  it("is not measured for non-JSON, empty or mutant-free reports", () => {
    expect(parseMutationReport("not json", "tool", 1)).toMatchObject({
      status: "not-measured",
    });
    expect(
      parseMutationReport(JSON.stringify({ files: { "a.ts": { mutants: [] } } }), "tool", 1),
    ).toMatchObject({ status: "not-measured" });
  });
});
