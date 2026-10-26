import { describe, expect, it } from "bun:test";
import { detectDrift, driftSummary, snapshotOf } from "../src/drift";

const before = snapshotOf({
  missing: ["src/a.ts", "src/b.ts"],
  operations: ["GET /users", "POST /users"],
});

describe("snapshotOf", () => {
  it("deduplicates and sorts paths and operations", () => {
    expect(
      snapshotOf({
        missing: ["src/b.ts", "src/a.ts", "src/a.ts"],
        operations: ["POST /users", "GET /users"],
      }),
    ).toEqual({
      missing: ["src/a.ts", "src/b.ts"],
      operations: ["GET /users", "POST /users"],
    });
  });
});

describe("detectDrift", () => {
  it("treats the first scan as a baseline", () => {
    const drift = detectDrift(undefined, before);
    expect(drift.changed).toBe(false);
    expect(drift.newFiles).toEqual([]);
  });

  it("reports no drift when the snapshot is unchanged", () => {
    expect(detectDrift(before, before).changed).toBe(false);
  });

  it("reports new and closed files plus contract changes", () => {
    const after = snapshotOf({
      missing: ["src/b.ts", "src/c.ts"],
      operations: ["POST /users", "GET /health"],
    });
    expect(detectDrift(before, after)).toEqual({
      newFiles: ["src/c.ts"],
      closedFiles: ["src/a.ts"],
      apiAdded: ["GET /health"],
      apiRemoved: ["GET /users"],
      changed: true,
    });
  });
});

describe("driftSummary", () => {
  it("produces one actionable summary without claiming a pull request", () => {
    const after = snapshotOf({
      missing: ["src/c.ts"],
      operations: ["POST /users", "GET /health"],
    });
    const summary = driftSummary("acme/api", detectDrift(before, after));
    expect(summary).toContain("EdgeSpec drift · acme/api");
    expect(summary).toContain("New untested files: 1");
    expect(summary).toContain("`src/c.ts`");
    expect(summary).toContain("New contract operations: 1");
    expect(summary).toContain("`GET /health`");
    expect(summary).toContain("No pull request was opened");
  });
});
