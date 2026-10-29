import { describe, expect, it } from "bun:test";
import {
  claimPrCommand,
  deleteRunHistory,
  getMemory,
  getPolicy,
  getWorkspace,
  listAudit,
  listRuns,
  purgeExpired,
  putMemory,
  putPolicy,
  putWorkspace,
  recordAudit,
  scheduledRepoView,
  workspaceView,
} from "../src/db";
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
    expect(await getPolicy(db, "acme/api")).toEqual({
      killSwitch: true,
      maxFiles: 9,
    });
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

  it("round-trips approved repository memory", async () => {
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
            return (stored ? { memory_json: stored } : null) as T | null;
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

    await putMemory(db, "acme/api", {
      naming: "sibling .test.ts",
      helpers: ["src/test-utils.ts"],
    });
    expect(await getMemory(db, "acme/api")).toEqual({
      naming: "sibling .test.ts",
      helpers: ["src/test-utils.ts"],
    });
  });

  it("deletes run files and runs for one repository in one batch", async () => {
    const { db, calls } = fakeDb([{ id: "run-1" }, { id: "run-2" }, { id: "run-3" }]);
    expect(await deleteRunHistory(db, "acme/api")).toEqual({
      deleted: 3,
      ids: ["run-1", "run-2", "run-3"],
    });
    const deletes = calls.filter((call) => call.sql.startsWith("DELETE"));
    expect(deletes).toHaveLength(2);
    expect(deletes.every((call) => call.values[0] === "acme/api")).toBe(true);
  });
});

/** An in-memory stand-in for the workspace and audit tables. */
function workspaceDb() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const events: Array<Record<string, unknown>> = [];
  let row: Record<string, unknown> | undefined;
  const prepare = (sql: string): D1PreparedStatement => {
    let values: unknown[] = [];
    const statement: D1PreparedStatement = {
      bind(...next: unknown[]) {
        values = next;
        return statement;
      },
      async first<T>(): Promise<T | null> {
        calls.push({ sql, values });
        if (sql.includes("FROM workspaces")) return (row ?? null) as T | null;
        if (sql.includes("COUNT(*)")) return { count: 2 } as T;
        return null;
      },
      async all<T>(): Promise<{ results?: T[] }> {
        calls.push({ sql, values });
        if (sql.includes("SELECT id FROM runs")) {
          return { results: [{ id: "run-1" }, { id: "run-2" }] as T[] };
        }
        return { results: events as T[] };
      },
      async run() {
        calls.push({ sql, values });
        if (sql.startsWith("INSERT INTO workspaces")) {
          row = {
            id: values[0],
            name: values[1],
            retention_days: values[2],
            drift_webhook_url: null,
            drift_webhook_secret: null,
            created_at: values[3],
            updated_at: values[4],
          };
        } else if (sql.startsWith("UPDATE workspaces")) {
          row = {
            ...row,
            name: values[0],
            retention_days: values[1],
            drift_webhook_url: values[2],
            drift_webhook_secret: values[3],
            updated_at: values[4],
          };
        } else if (sql.startsWith("INSERT INTO audit_events")) {
          events.unshift({
            id: events.length + 1,
            repo: values[1],
            actor: values[2],
            action: values[3],
            detail_json: values[4],
            created_at: values[5],
          });
        }
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

describe("workspace settings and audit", () => {
  it("creates the default workspace lazily and clamps updates", async () => {
    const { db } = workspaceDb();
    expect(await getWorkspace(db)).toMatchObject({
      id: "default",
      name: "Default workspace",
      retentionDays: 30,
    });

    const updated = await putWorkspace(db, {
      name: "  Platform  ",
      retentionDays: 0,
    });
    expect(updated.name).toBe("Platform");
    expect(updated.retentionDays).toBe(1);
    expect(await getWorkspace(db)).toMatchObject({
      name: "Platform",
      retentionDays: 1,
    });
  });

  it("stores workspace drift webhooks and never exposes the secret in public views", async () => {
    const { db } = workspaceDb();
    const updated = await putWorkspace(db, {
      driftWebhookUrl: "https://hooks.example/workspace",
      driftWebhookSecret: "shared-secret",
    });
    expect(updated).toMatchObject({
      driftWebhookUrl: "https://hooks.example/workspace",
      driftWebhookSecret: "shared-secret",
    });
    expect(workspaceView(updated)).toMatchObject({
      driftWebhookUrl: "https://hooks.example/workspace",
      driftWebhookSecretSet: true,
    });
    expect("driftWebhookSecret" in workspaceView(updated)).toBe(false);

    const changed = await putWorkspace(db, {
      driftWebhookUrl: "https://hooks.example/replaced",
    });
    expect(changed.driftWebhookUrl).toBe("https://hooks.example/replaced");
    expect(changed.driftWebhookSecret).toBeUndefined();

    const cleared = await putWorkspace(db, { driftWebhookUrl: "" });
    expect(cleared.driftWebhookUrl).toBeUndefined();
    expect(cleared.driftWebhookSecret).toBeUndefined();

    const schedule = scheduledRepoView({
      repo: "acme/api",
      intervalDays: 7,
      enabled: true,
      driftWebhookUrl: "https://hooks.example/repo",
      driftWebhookSecret: "repo-secret",
    });
    expect(schedule.driftWebhookSecretSet).toBe(true);
    expect("driftWebhookSecret" in schedule).toBe(false);
  });

  it("removes secret-looking keys from audit detail", async () => {
    const { db } = workspaceDb();
    await recordAudit(db, {
      repo: "acme/api",
      actor: "dashboard",
      action: "test",
      detail: {
        aiKey: "secret",
        nested: { authorization: "Bearer x", files: 2 },
      },
    });

    const [event] = await listAudit(db, { repo: "acme/api" });
    expect(event?.detail).toEqual({ nested: { files: 2 } });
  });

  it("counts and deletes rows past retention", async () => {
    const { db, calls } = workspaceDb();
    expect(await purgeExpired(db, 7, 100 * 86_400_000)).toEqual({
      runs: 2,
      audit: 2,
      ids: ["run-1", "run-2"],
    });
    const deletes = calls.filter((call) => call.sql.startsWith("DELETE"));
    expect(deletes).toHaveLength(4);
    expect(deletes[0]?.values[0]).toBe(93 * 86_400_000);
  });
});
