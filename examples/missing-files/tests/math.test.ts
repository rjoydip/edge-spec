import { describe, expect, test } from "bun:test";
import { add, divide } from "../src/math";

describe("math", () => {
  test("adds", () => {
    expect(add(2, 3)).toBe(5);
  });

  test("divides and rejects zero", () => {
    expect(divide(9, 3)).toBe(3);
    expect(() => divide(1, 0)).toThrow("zero");
  });
});
