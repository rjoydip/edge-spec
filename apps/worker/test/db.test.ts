import { describe, expect, it } from "bun:test";
import { claimPrCommand, deleteRunHistory, getPolicy, listRuns, putPolicy } from "../src/db";
import type { D1Database, D1PreparedStatement } from "../src/env";

/** A D1 stand-in: records bound values and returns one prepared result set. */
function fakeDb(rows: unknown[], count?: number) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const prepare = (sql: string): D1PreparedStatement => {
    let values: unknown[] = [];
    const statement: D1PreparedStatement = {
      bind(...next: unknown[]) {
        values = next;
        return statement;
      },
      async first<T>(): Promise<T | null> {
        calls.push({ sql, values });
        return (count === undefined ? null : { count }) as T | null;
      },
      async all<T>(): Promise<{ results?: T[] }> {
        calls.push({ sql, values });
        return { results: rows as T[] };
      },
      async run() {
        calls.push({ sql, values });
        return {};
      },
    };
    return statement;
  };
  const db = {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as D1Database;
  return { db, calls };
}

describe("run history queries", () => {
  it("maps a stored run without inventing fields", async () => {
    const { db, calls } = fakeDb([
      {
        id: "run-1",
        repo: "acme/api",
        ref: "main",
        status: "ready",
        provider: "openai",
        model: "gpt-6",
        started_at: 10,
        finished_at: 20,
        totals_json: JSON.stringify({
          missing: 2,
          coverage: 1,
          api: 0,
          unsupported: 1,
          skipped: 4,
        }),
        cost: null,
      },
    ]);

    const runs = await listRuns(db, "acme/api", 999);
    expect(runs[0]).toMatchObject({
      id: "run-1",
      status: "ready",
      startedAt: 10,
      finishedAt: 20,
      totals: { missing: 2, skipped: 4 },
    });
    expect(runs[0]?.cost).toBeUndefined();
    // The limit is clamped before it reaches D1.
    expect(calls[0]?.values).toEqual(["acme/api", 50]);
  });

  it("round-trips a repository policy through D1", async () => {
    let stored: string | undefined;
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        const statement: D1PreparedStatement = {
          bind(...next: unknown[]) {
            values = next;
            return statement;
          },
          async first<T>(): Promise<T | null> {
            return (stored ? { policy_json: stored } : null) as T | null;
          },
          async all<T>(): Promise<{ results?: T[] }> {
            return { results: [] };
          },
          async run() {
            if (sql.startsWith("INSERT")) stored = String(values[1]);
            return {};
          },
        };
        return statement;
      },
      async batch() {
        return [];
      },
    } as D1Database;

    await putPolicy(db, "acme/api", { killSwitch: true, maxFiles: 9 });
    expect(await getPolicy(db, "acme/api")).toEqual({ killSwitch: true, maxFiles: 9 });
  });

  it("rate limits one command per user and window", async () => {
    let started: number | undefined;
    const db = {
      prepare() {
        let values: unknown[] = [];
        const statement: D1PreparedStatement = {
          bind(...next: unknown[]) {
            values = next;
            return statement;
          },
          async first<T>(): Promise<T | null> {
            return (started === undefined ? null : { started_at: started }) as T | null;
          },
          async all<T>(): Promise<{ results?: T[] }> {
            return { results: [] };
          },
          async run() {
            started = Number(values[4]);
            return {};
          },
        };
        return statement;
      },
      async batch() {
        return [];
      },
    } as D1Database;

    expect(await claimPrCommand(db, "acme/api", 1, "alice", "retest", 60_000, 1_000)).toBe(true);
    expect(await claimPrCommand(db, "acme/api", 1, "alice", "retest", 60_000, 30_000)).toBe(false);
    expect(await claimPrCommand(db, "acme/api", 1, "alice", "retest", 60_000, 62_000)).toBe(true);
  });

  it("deletes run files and runs for one repository in one batch", async () => {
    const { db, calls } = fakeDb([], 3);
    expect(await deleteRunHistory(db, "acme/api")).toBe(3);
    const deletes = calls.filter((call) => call.sql.startsWith("DELETE"));
    expect(deletes).toHaveLength(2);
    expect(deletes.every((call) => call.values[0] === "acme/api")).toBe(true);
  });
});
