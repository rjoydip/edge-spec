import { describe, expect, it } from "bun:test";
import { PR_CHECK_MARKER, buildPrCheck } from "../src/pr-check";
import type { Gap } from "../src/types";

function gap(path: string): Gap {
  return {
    path,
    testPath: path.replace(/\.ts$/, ".test.ts"),
    risk: "medium",
    exports: [],
    reason: "no test",
  };
}

describe("buildPrCheck", () => {
  it("is static only, neutral, and says so when no runner is configured", () => {
    const check = buildPrCheck({
      changedFiles: ["src/a.ts"],
      gaps: [gap("src/a.ts")],
      affectedTests: [],
      runner: false,
    });

    expect(check.conclusion).toBe("neutral");
    expect(check.output.title).toBe("Static check only");
    expect(check.output.annotations[0]).toMatchObject({
      path: "src/a.ts",
      start_line: 1,
      level: "notice",
      title: "No test found · static only",
    });
    expect(check.output.annotations[0]?.message).toContain("static check only");
    expect(check.output.summary).toContain("static only, never passed");
    expect(check.comment.startsWith(PR_CHECK_MARKER)).toBe(true);
  });

  it("passes when changed files are covered and affected tests pass", () => {
    const check = buildPrCheck({
      changedFiles: ["src/a.ts", "src/a.test.ts"],
      gaps: [],
      affectedTests: ["src/a.test.ts"],
      runner: true,
      testRun: { ok: true, output: "2 pass", durationMs: 120 },
    });

    expect(check.conclusion).toBe("success");
    expect(check.output.annotations).toEqual([]);
    expect(check.output.summary).toContain("ran on the runner · passed in 120 ms");
  });

  it("fails when the affected suite fails and annotates it", () => {
    const check = buildPrCheck({
      changedFiles: ["src/a.ts"],
      gaps: [],
      affectedTests: ["src/a.test.ts"],
      runner: true,
      testRun: { ok: false, output: "expected 2, got 3", durationMs: 80 },
    });

    expect(check.conclusion).toBe("failure");
    expect(check.output.annotations[0]).toMatchObject({
      path: "src/a.test.ts",
      level: "failure",
      title: "Affected tests failed",
    });
    expect(check.output.annotations[0]?.message).toContain("expected 2, got 3");
  });

  it("explains why a test was selected and admits a partial graph", () => {
    const check = buildPrCheck({
      changedFiles: ["src/c.ts"],
      gaps: [],
      affectedTests: ["src/a.test.ts"],
      runner: true,
      impact: [{ test: "src/a.test.ts", via: ["src/c.ts", "src/b.ts", "src/a.test.ts"] }],
      partialImpact: true,
    });
    expect(check.output.summary).toContain("### Impact");
    expect(check.output.summary).toContain(
      "`src/a.test.ts` ← `src/c.ts` → `src/b.ts` → `src/a.test.ts`",
    );
    expect(check.output.summary).toContain("Partial graph");
  });

  it("caps annotations at GitHub's limit but keeps the gap count", () => {
    const gaps = Array.from({ length: 60 }, (_, index) => gap(`src/f${index}.ts`));
    const check = buildPrCheck({
      changedFiles: gaps.map((item) => item.path),
      gaps,
      affectedTests: [],
      runner: true,
    });
    expect(check.output.annotations).toHaveLength(50);
    expect(check.output.summary).toContain("60 changed source(s) have no test");
  });
});
