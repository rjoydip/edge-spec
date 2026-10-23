import { describe, expect, test } from "bun:test";
import { shippingCents } from "./pricing";

describe("shippingCents", () => {
  test("is free over the threshold", () => {
    expect(shippingCents(5000, false)).toBe(0);
  });
});
