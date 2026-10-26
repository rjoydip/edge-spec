import { describe, expect, test } from "bun:test";
import { isLocalPathInput } from "../src/lib/local-path";

describe("isLocalPathInput", () => {
  test("accepts explicit local paths", () => {
    for (const value of [
      "/Users/ada/project",
      "./examples/missing-openapi",
      "../hono",
      "~/code/hono",
      "C:\\code\\hono",
      "C:/code/hono",
      "\\\\server\\share\\project",
    ]) {
      expect(isLocalPathInput(value)).toBe(true);
    }
  });

  test("leaves repository input alone", () => {
    for (const value of ["owner/repo", "owner/repo/src/app", "https://github.com/owner/repo"]) {
      expect(isLocalPathInput(value)).toBe(false);
    }
  });

  test("ignores empty input", () => {
    expect(isLocalPathInput("   ")).toBe(false);
  });
});
