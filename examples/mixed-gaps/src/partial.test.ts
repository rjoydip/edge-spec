import { describe, expect, test } from "bun:test";
import { clamp } from "./partial";

describe("clamp", () => {
  test("clamps high values", () => {
    expect(clamp(10, 0, 5)).toBe(5);
  });
});
