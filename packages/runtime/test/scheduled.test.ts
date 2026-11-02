/**
 * Scheduled drift path without a live GitHub or D1: the injected GitHub takes
 * the network out, and the fake database records the audit writes.
 */
import { describe, expect, it } from "bun:test";
import type { GitHub } from "@edge-spec/core/github";
import { runScheduled } from "../src/scheduled";
import type { Env, SqlDatabase, SqlStatement } from "../src/env";

const NOW = 10 * 86_400_000;

function fakeDb(previousSnapshot: boolean) {
  const statements: string[] = [];
  const binds: unknown[][] = [];
  const prepare = (sql: string): SqlStatement => {
    const statement: SqlStatement = {
      bind(...next: unknown[]) {
        binds.push(next);
        return statement;
      },
      async first<T>() {
        if (sql.includes("FROM drift_snapshots")) {
          return (
            previousSnapshot ? { missing_json: "[]", operations_json: "[]" } : null
          ) as T | null;
        }
        if (sql.includes("COUNT(*)")) return { count: 0 } as T;
        return null;
      },
      async all<T>() {
        if (sql.includes("FROM scheduled_repos")) {
          return {
            results: [
              {
                repo: "acme/api",
                interval_days: 7,
                enabled: 1,
                installation_id: null,
                last_run_at: null,
                drift_webhook_url: null,
                drift_webhook_secret: null,
              },
            ] as T[],
          };
        }
        return { results: [] as T[] };
      },
      async run() {
        return { meta: { changes: 0 } };
      },
    };
    return statement;
  };
  const db: SqlDatabase = { prepare, batch: async () => [] };
  return { db, statements, binds };
}

const github = {
  defaultBranch: async () => "main",
  tree: async () => [{ type: "blob", path: "src/a.ts" }],
  file: async () => "",
} as unknown as GitHub;

async function run(env: Env, previousSnapshot = false) {
  const { db, statements, binds } = fakeDb(previousSnapshot);
  const pending: Promise<unknown>[] = [];
  await runScheduled(
    { scheduledTime: NOW, cron: "0 8 * * *" },
    { ...env, DB: db },
    { waitUntil: (promise) => void pending.push(promise) },
    { github },
  );
  await Promise.all(pending);
  return { statements, binds };
}

describe("scheduled drift", () => {
  it("records the drift scan in the audit log", async () => {
    const { binds } = await run({});
    expect(binds.some((values) => values[3] === "drift_scan")).toBe(true);
  });

  it("emails the summary when no webhook is configured", async () => {
    const original = globalThis.fetch;
    let body: { to?: string[]; subject?: string } | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const { binds } = await run(
        {
          DRIFT_ALERT_EMAIL: "ops@example.com",
          EMAIL_API_KEY: "re_test",
          EMAIL_FROM: "EdgeSpec <noreply@example.com>",
        },
        true,
      );
      expect(body?.to).toEqual(["ops@example.com"]);
      expect(body?.subject).toContain("acme/api");
      const audit = binds.find((values) => values[3] === "drift_scan");
      expect(JSON.parse(String(audit?.[4]))).toMatchObject({ notified: true, email: true });
    } finally {
      globalThis.fetch = original;
    }
  });
});
