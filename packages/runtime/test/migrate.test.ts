/**
 * The Postgres migration must be re-runnable: a second `bun run migrate` skips
 * an applied version, and a failed apply leaves the ledger empty.
 */
import { describe, expect, it } from "bun:test";
import { applySchema, schemaVersion, type SqlClient } from "../scripts/migrate";

interface Fake {
  client: SqlClient;
  calls: string[];
  applied: Set<string>;
}

function fake(applied: string[] = [], failOn?: string): Fake {
  const done = new Set(applied);
  const calls: string[] = [];
  return {
    applied: done,
    calls,
    client: {
      async query(text: string, values?: unknown[]) {
        calls.push(text);
        if (text.includes("SELECT 1 FROM schema_migrations")) {
          const version = String(values?.[0]);
          return { rows: done.has(version) ? [{ "?column?": 1 }] : [] };
        }
        if (failOn && text.includes(failOn)) throw new Error("schema failed");
        if (text.includes("INSERT INTO schema_migrations")) done.add(String(values?.[0]));
        return { rows: [] };
      },
    },
  };
}

const SQL = "CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY);";
const VERSION = "postgres.sql:abc123";

describe("postgres migration", () => {
  it("creates the ledger, applies the schema and records the version", async () => {
    const { client, calls, applied } = fake();

    expect(await applySchema(client, VERSION, SQL)).toBe(true);
    expect(calls[0]).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
    expect(calls).toContain("BEGIN");
    expect(calls).toContain(SQL);
    expect(calls).toContain("COMMIT");
    expect(applied.has(VERSION)).toBe(true);
  });

  it("skips a version the ledger already recorded", async () => {
    const { client, calls } = fake([VERSION]);

    expect(await applySchema(client, VERSION, SQL)).toBe(false);
    expect(calls.some((sql) => sql.includes("BEGIN"))).toBe(false);
    expect(calls).not.toContain(SQL);
  });

  it("rolls back and records nothing when the schema fails", async () => {
    const { client, calls, applied } = fake([], "CREATE TABLE IF NOT EXISTS runs");

    await expect(applySchema(client, VERSION, SQL)).rejects.toThrow("schema failed");
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
    expect(applied.size).toBe(0);
  });
});

describe("schema version", () => {
  it("changes when the file changes", () => {
    const first = schemaVersion("postgres.sql", SQL);
    expect(schemaVersion("postgres.sql", SQL)).toBe(first);
    expect(schemaVersion("postgres.sql", `${SQL}\n-- edited`)).not.toBe(first);
    expect(schemaVersion("other.sql", SQL)).not.toBe(first);
    expect(first.startsWith("postgres.sql:")).toBe(true);
    expect(first).not.toContain("CREATE TABLE");
  });
});
