import { describe, expect, test } from "bun:test";
import { displayName } from "../src/user";

describe("user", () => {
  test("uses the full name when a last name exists", () => {
    expect(displayName({ firstName: " Ada ", lastName: " Lovelace " })).toBe("Ada Lovelace");
  });

  test("falls back to the first name", () => {
    expect(displayName({ firstName: " Ada " })).toBe("Ada");
    expect(displayName({ firstName: "Ada", lastName: "  " })).toBe("Ada");
  });
});
