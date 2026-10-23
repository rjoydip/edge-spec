import { describe, expect, it } from "bun:test";
import { nextPendingGap } from "../src/queue";
import type { Gap } from "../src/types";

const gap = (path: string): Gap => ({
  path,
  testPath: path.replace(/\.ts$/, ".test.ts"),
  risk: "low",
  exports: [],
  reason: "no sibling test",
});

const gaps = [gap("src/a.ts"), gap("src/b.ts"), gap("src/c.ts")];

describe("nextPendingGap", () => {
  it("picks the next gap after the selected one", () => {
    expect(nextPendingGap(gaps, [], "src/a.ts")?.path).toBe("src/b.ts");
  });

  it("wraps around and skips gaps that already have a test", () => {
    expect(nextPendingGap(gaps, ["src/b.ts"], "src/a.ts")?.path).toBe("src/c.ts");
    expect(nextPendingGap(gaps, ["src/b.ts"], "src/c.ts")?.path).toBe("src/a.ts");
  });

  it("returns undefined when every other gap is generated", () => {
    expect(nextPendingGap(gaps, ["src/b.ts", "src/c.ts"], "src/a.ts")).toBeUndefined();
  });

  it("falls back to the first pending gap when the selection is stale", () => {
    expect(nextPendingGap(gaps, ["src/a.ts"], "src/gone.ts")?.path).toBe("src/b.ts");
  });
});
