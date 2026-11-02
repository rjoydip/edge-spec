/**
 * Postgres speaks `$1` placeholders; the shared SQL is written for SQLite. The
 * converter is the only thing standing between the two. Runtime SQL is exercised
 * through the same converter in `packages/runtime/test/db-sql.test.ts`.
 */
import { describe, expect, it } from "bun:test";
import { placeholders } from "../src/postgres";

describe("postgres placeholders", () => {
  it("numbers only unquoted question marks", () => {
    expect(placeholders("SELECT '?', \"?\", ? , ?")).toBe("SELECT '?', \"?\", $1 , $2");
  });

  it("leaves comments alone", () => {
    expect(placeholders("SELECT ? -- ?\n, ?")).toBe("SELECT $1 -- ?\n, $2");
  });
});
