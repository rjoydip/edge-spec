import { describe, expect, test } from "bun:test";
import { titleCase } from "../src/text";

describe("text", () => {
  test("title-cases words and trims", () => {
    expect(titleCase("  hello WORLD ")).toBe("Hello World");
  });

  test("returns an empty string for blank input", () => {
    expect(titleCase("   ")).toBe("");
  });
});
