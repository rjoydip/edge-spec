/**
 * `POST /api/cron/tick` is the portable cron entry: hosts that cannot call a
 * `scheduled` handler post here instead. It must be closed without a secret and
 * must run the scheduler exactly once per call.
 */
import { describe, expect, it } from "bun:test";
import { app } from "../src/app";
import type { Env, SqlDatabase, SqlStatement } from "../src/env";

const SECRET = "cron-secret";
const URL = "https://edge.example/api/cron/tick";

/** Records the SQL the scheduler touches; empty results mean "nothing due". */
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

const tick = async (env: Env, headers: Record<string, string> = {}): Promise<Response> =>
  app.fetch(new Request(URL, { method: "POST", headers }), env);

describe("cron tick", () => {
  it("is not a route without a secret", async () => {
    const response = await tick({});
    expect(response.status).toBe(404);
  });

  it("rejects a wrong secret", async () => {
    const response = await tick({ CRON_SECRET: SECRET }, { "x-cron-secret": "wrong" });
    expect(response.status).toBe(401);
  });

  it("accepts the header and the bearer form", async () => {
    const cases: Array<Record<string, string>> = [
      { "x-cron-secret": SECRET },
      { authorization: `Bearer ${SECRET}` },
    ];
    for (const headers of cases) {
      const response = await tick({ CRON_SECRET: SECRET }, headers);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
  });

  it("runs the scheduler once per call", async () => {
    const { db, statements } = recordingDb();
    const env = { CRON_SECRET: SECRET, DB: db } as Env;
    const response = await tick(env, { "x-cron-secret": SECRET });
    expect(response.status).toBe(200);
    // The scheduler reads the workspace, then lists due repositories. One call
    // must mean one of each, not zero (a no-op route) or two (a double run).
    expect(statements.filter((sql) => sql.includes("FROM workspaces")).length).toBe(1);
    expect(statements.filter((sql) => sql.includes("FROM scheduled_repos")).length).toBe(1);
  });
});
