/**
 * Postgres speaks `$1` placeholders; the shared SQL is written for SQLite. The
 * converter is the only thing standing between the two, and the `repo_memory`
 * upsert is the statement that relies on it most.
 */
import { describe, expect, it } from "bun:test";
import { placeholders } from "../src/adapters/postgres";
import { putMemory } from "../src/db";
import type { SqlDatabase, SqlStatement } from "../src/env";

describe("postgres placeholders", () => {
  it("numbers only unquoted question marks", () => {
    expect(placeholders("SELECT '?', \"?\", ? , ?")).toBe("SELECT '?', \"?\", $1 , $2");
  });

  it("leaves comments alone", () => {
    expect(placeholders("SELECT ? -- ?\n, ?")).toBe("SELECT $1 -- ?\n, $2");
  });
});

/** Records the SQL `putMemory` prepares, without running it. */
function recordingDb(): { db: SqlDatabase; statements: string[] } {
  const statements: string[] = [];
  const statement = {
    bind: () => statement,
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { changes: 0 } }),
  } as unknown as SqlStatement;
  const db: SqlDatabase = {
    prepare(sql: string) {
      statements.push(sql);
      return statement;
    },
    batch: async () => [],
  };
  return { db, statements };
}

describe("postgres repo_memory upsert", () => {
  it("numbers the upsert and keeps the conflict clause", async () => {
    const { db, statements } = recordingDb();

    await putMemory(db, "acme/api", { naming: "sibling .test.ts" });

    const sql = statements.find((text) => text.includes("repo_memory"));
    expect(sql).toBeDefined();
    const converted = placeholders(sql as string);
    expect(converted).toContain("VALUES ($1, $2, $3)");
    expect(converted).toContain(
      "ON CONFLICT(repo) DO UPDATE SET memory_json = excluded.memory_json",
    );
    expect(converted).not.toContain("?");
  });
});
