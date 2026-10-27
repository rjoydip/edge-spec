import { describe, expect, it } from "bun:test";
import { compareRuns, type RunDetail, type RunFile } from "../src/history";

const totals = (missing: number) => ({
  missing,
  coverage: 0,
  api: 0,
  unsupported: 0,
  skipped: 0,
});

function file(sourcePath: string, overrides: Partial<RunFile> = {}): RunFile {
  return {
    sourcePath,
    testPath: sourcePath.replace(/\.ts$/, ".test.ts"),
    decision: "pending",
    verified: false,
    checks: [],
    ...overrides,
  };
}

const before: RunDetail = {
  run: {
    id: "before",
    repo: "acme/api",
    ref: "main",
    status: "ready",
    provider: "openai",
    model: "gpt-6",
    startedAt: 1,
    totals: totals(3),
  },
  files: [
    file("src/a.ts", {
      decision: "accepted",
      verified: true,
      coverage: {
        status: "measured",
        path: "src/a.ts",
        lines: { before: 1, after: 2, delta: 1, total: 4 },
      },
    }),
    file("src/b.ts"),
  ],
};

const after: RunDetail = {
  run: {
    id: "after",
    repo: "acme/api",
    ref: "main",
    status: "ready",
    provider: "openai",
    model: "gpt-6",
    startedAt: 2,
    totals: totals(1),
  },
  files: [
    file("src/b.ts", { decision: "rejected", verified: true }),
    file("src/c.ts", {
      decision: "accepted",
      verified: true,
      coverage: { status: "not-measured" },
    }),
  ],
};

describe("compareRuns", () => {
  it("compares totals, files, verification and decisions", () => {
    const result = compareRuns(before, after);
    expect(result.missing).toEqual({ before: 3, after: 1, delta: -2 });
    expect(result.files).toEqual({ before: 2, after: 2 });
    expect(result.verified).toEqual({ before: 1, after: 2 });
    expect(result.accepted).toEqual({ before: 1, after: 1 });
    expect(result.rejected).toEqual({ before: 0, after: 1 });
    expect(result.newFiles).toEqual(["src/c.ts"]);
    expect(result.closedFiles).toEqual(["src/a.ts"]);
  });

  it("sums only measured coverage deltas, never inferred ones", () => {
    const result = compareRuns(before, after);
    expect(result.coverageLines).toEqual({ before: 1, after: 0, delta: -1 });
  });
});
