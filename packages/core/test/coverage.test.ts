import { describe, expect, it } from "bun:test";
import { coverageDelta, coverageGaps, coverageTargetFor, parseLcov } from "../src/coverage";

const LCOV = [
  "SF:src/math.ts",
  "DA:1,1",
  "DA:2,1",
  "DA:3,0",
  "BRDA:2,0,0,1",
  "BRDA:2,0,1,-",
  "end_of_record",
  "SF:src/user.ts",
  "DA:10,0",
  "end_of_record",
].join("\n");

describe("parseLcov", () => {
  it("sums lines and branches across files", () => {
    const report = parseLcov(LCOV);
    expect(report?.lines).toEqual({ covered: 2, total: 4 });
    expect(report?.branches).toEqual({ covered: 1, total: 2 });
    expect(report?.files).toHaveLength(2);
    expect(report?.files[0]?.uncoveredLines).toEqual([3]);
    expect(report?.files[0]?.uncoveredBranches).toEqual([2]);
  });

  it("returns undefined for no report so callers say 'not measured'", () => {
    expect(parseLcov("")).toBeUndefined();
    expect(parseLcov("not lcov")).toBeUndefined();
  });

  it("normalizes a leading ./ in report paths", () => {
    expect(parseLcov("SF:./src/a.ts\nDA:1,1\nend_of_record")?.files[0]?.path).toBe("src/a.ts");
  });
});

describe("coverageDelta", () => {
  const before = parseLcov(
    ["SF:src/math.ts", "DA:1,1", "DA:2,0", "BRDA:2,0,0,1", "BRDA:2,0,1,-", "end_of_record"].join(
      "\n",
    ),
  );
  const after = parseLcov(
    [
      "SF:/tmp/repo/src/math.ts",
      "DA:1,1",
      "DA:2,1",
      "BRDA:2,0,0,1",
      "BRDA:2,0,1,1",
      "end_of_record",
    ].join("\n"),
  );

  it("measures line and branch deltas from two reports, matching absolute paths", () => {
    expect(coverageDelta(before, after, "src/math.ts")).toEqual({
      status: "measured",
      path: "src/math.ts",
      lines: { before: 1, after: 2, delta: 1, total: 2 },
      branches: { before: 1, after: 2, delta: 1, total: 2 },
    });
  });

  it("is not measured when either report is missing or silent about the file", () => {
    expect(coverageDelta(undefined, after, "src/math.ts")).toEqual({ status: "not-measured" });
    expect(coverageDelta(before, after, "src/user.ts")).toEqual({ status: "not-measured" });
  });
});

describe("coverageTargetFor", () => {
  it("returns the measured uncovered lines and branches for one file", () => {
    const report = parseLcov(LCOV);
    expect(coverageTargetFor(report, "src/math.ts")).toEqual({
      path: "src/math.ts",
      uncoveredLines: [3],
      uncoveredBranches: [2],
    });
  });

  it("returns nothing when the file is fully covered or not in the report", () => {
    const full = parseLcov("SF:src/full.ts\nDA:1,1\nend_of_record");
    expect(coverageTargetFor(full, "src/full.ts")).toBeUndefined();
    expect(coverageTargetFor(undefined, "src/full.ts")).toBeUndefined();
  });
});

describe("coverageGaps", () => {
  const report = parseLcov(
    [
      "SF:src/math.ts",
      "DA:1,1",
      "DA:2,1",
      "DA:3,0",
      "end_of_record",
      "SF:src/untested.ts",
      "DA:1,0",
      "end_of_record",
      "SF:src/full.ts",
      "DA:1,1",
      "end_of_record",
    ].join("\n"),
  );

  it("only reports files that already have a test, with line evidence", () => {
    if (!report) throw new Error("fixture did not parse");
    const gaps = coverageGaps(
      ["src/math.ts", "src/untested.ts", "src/full.ts", "src/math.test.ts"],
      report,
      90,
      new Map([
        ["src/math.ts", ["src/math.test.ts"]],
        ["src/full.ts", ["src/full.test.ts"]],
      ]),
    );
    // A file with no test stays missing; a fully covered file is not a gap.
    expect(gaps.map((gap) => gap.path)).toEqual(["src/math.ts"]);
    expect(gaps[0]).toMatchObject({
      kind: "coverage",
      reason: expect.stringContaining("uncovered lines 3"),
      evidence: { uncoveredLines: [3], lineRate: 66.7 },
    });
  });

  it("returns nothing when every file meets the target", () => {
    if (!report) throw new Error("fixture did not parse");
    expect(
      coverageGaps(["src/full.ts"], report, 90, new Map([["src/full.ts", ["a.test.ts"]]])),
    ).toEqual([]);
  });
});
