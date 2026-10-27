import { describe, expect, it } from "bun:test";
import { ownerForPath, ownersForPath, parseCodeowners } from "../src/codeowners";

const TEXT = [
  "# comment",
  "*          @fallback",
  "src/*.ts   @ts-owner",
  "/docs/     @docs-team @writer",
  "src/auth/  @security",
  "bad-line-without-owner",
].join("\n");

describe("parseCodeowners", () => {
  it("reads patterns and owners, skipping comments and malformed lines", () => {
    const entries = parseCodeowners(TEXT);
    expect(entries.map((entry) => entry.pattern)).toEqual(["*", "src/*.ts", "/docs/", "src/auth/"]);
    expect(entries[3]?.owners).toEqual(["@security"]);
  });
});

describe("ownersForPath", () => {
  const entries = parseCodeowners(TEXT);

  it("uses the last matching rule", () => {
    expect(ownersForPath(entries, "src/index.ts")).toEqual(["@ts-owner"]);
    expect(ownersForPath(entries, "src/auth/token.ts")).toEqual(["@security"]);
    expect(ownersForPath(entries, "docs/guide.md")).toEqual(["@docs-team", "@writer"]);
  });

  it("falls back to a basename rule", () => {
    expect(ownerForPath(entries, "packages/core/src/a.ts")).toBe("@fallback");
    expect(ownerForPath(entries, "random/file.py")).toBe("@fallback");
  });

  it("returns nothing when no rule matches or the file is blank", () => {
    expect(ownersForPath(parseCodeowners(""), "src/a.ts")).toEqual([]);
    expect(ownerForPath([], "src/a.ts")).toBeUndefined();
  });
});
