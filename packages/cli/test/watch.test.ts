import { describe, expect, it } from "bun:test";
import { diffLines, isWatchSource, testPathFor } from "../src/watch";

describe("isWatchSource", () => {
  it("accepts source and ignores tests and build output", () => {
    expect(isWatchSource("src/a.ts")).toBe(true);
    expect(isWatchSource("src/a.tsx")).toBe(true);
    expect(isWatchSource("src/a.test.ts")).toBe(false);
    expect(isWatchSource("src/a.spec.tsx")).toBe(false);
    expect(isWatchSource("node_modules/x/a.ts")).toBe(false);
    expect(isWatchSource("dist/a.js")).toBe(false);
    expect(isWatchSource("README.md")).toBe(false);
  });
});

describe("testPathFor", () => {
  it("puts .test before the extension", () => {
    expect(testPathFor("src/a.ts")).toBe("src/a.test.ts");
    expect(testPathFor("src/App.tsx")).toBe("src/App.test.tsx");
    expect(testPathFor("src/a.mjs")).toBe("src/a.test.mjs");
  });
});

describe("diffLines", () => {
  it("shows only the changed middle", () => {
    const before = "import a\nold\nsame";
    const after = "import a\nnew\nextra\nsame";
    expect(diffLines(before, after)).toBe("- old\n+ new\n+ extra");
  });

  it("says when nothing changed", () => {
    expect(diffLines("same", "same")).toBe("No changes.");
  });
});
