import { describe, expect, test } from "bun:test";
import { greeting } from "./greeting";

describe("greeting", () => {
  test("greets a name", () => {
    expect(greeting(" Ada ")).toBe("Hello, Ada!");
  });

  test("falls back for a blank name", () => {
    expect(greeting("   ")).toBe("Hello, world!");
  });
});
