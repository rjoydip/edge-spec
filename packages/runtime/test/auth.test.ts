/**
 * Better Auth over the real sqlite driver and the real migrations. Exercises
 * the Hono surface (`/api/auth/*`) rather than the library in isolation, so
 * the adapter, the mount and the session cookie are tested together.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { app } from "../src/app";
import { applySqliteMigrations, createSqlite, type SqlLikeDatabase } from "@edge-spec/db";
import type { Env, SqlDatabase } from "../src/env";
import { whereSql } from "../src/auth-adapter";

let db: SqlLikeDatabase;

beforeEach(async () => {
  db = createSqlite({ path: ":memory:" });
  await applySqliteMigrations(db, join(import.meta.dir, "..", "..", "..", "migrations"));
});
afterEach(() => {
  void db;
});

const call = (
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string>; env?: Partial<Env> } = {},
): Promise<Response> =>
  Promise.resolve(
    app.fetch(
      new Request(`https://edge.example${path}`, {
        method,
        headers: {
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...init.headers,
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
      {
        DB: db as unknown as SqlDatabase,
        BETTER_AUTH_URL: "https://edge.example",
        ...init.env,
      } as Env,
    ),
  );

const signUp = (email: string, password = "longenough1") =>
  call("POST", "/api/auth/sign-up/email", { body: { email, password, name: "Dev" } });

const sessionCookie = (response: Response): string =>
  (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

describe("whereSql", () => {
  test("builds parameterised clauses for every operator", () => {
    expect(whereSql([{ field: "email", value: "a@b.dev" }])).toEqual({
      sql: 'WHERE "email" = ?',
      values: ["a@b.dev"],
    });
    expect(
      whereSql([
        { field: "id", value: "x" },
        { field: "userId", value: "y", connector: "AND" },
      ]),
    ).toEqual({ sql: 'WHERE "id" = ? AND "userId" = ?', values: ["x", "y"] });
    expect(whereSql([{ field: "expiresAt", value: "2026", operator: "gt" }])).toEqual({
      sql: 'WHERE "expiresAt" > ?',
      values: ["2026"],
    });
    expect(whereSql([{ field: "image", value: null, operator: "ne" }])).toEqual({
      sql: 'WHERE "image" IS NOT NULL',
      values: [],
    });
    expect(whereSql([{ field: "email", value: "A@B.DEV", mode: "insensitive" }])).toEqual({
      sql: 'WHERE LOWER("email") = ?',
      values: ["a@b.dev"],
    });
  });
});

describe("better auth routes", () => {
  test("signup creates a user row and a session cookie", async () => {
    const response = await signUp("dev@example.dev");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token?: string;
      user: { email: string; emailVerified?: boolean };
    };
    expect(body.user.email).toBe("dev@example.dev");
    expect(body.user.emailVerified).toBe(false);
    expect(sessionCookie(response)).toContain("better-auth.session_token");
  });

  test("get-session resolves the cookie and sign-out clears it", async () => {
    const created = await signUp("session@example.dev");
    const cookie = sessionCookie(created);

    const session = await call("GET", "/api/auth/get-session", { headers: { cookie } });
    expect(session.status).toBe(200);
    const body = (await session.json()) as { user?: { email?: string } } | null;
    expect(body?.user?.email).toBe("session@example.dev");

    const out = await call("POST", "/api/auth/sign-out", { headers: { cookie } });
    expect(out.status).toBe(200);
    const after = await call("GET", "/api/auth/get-session", { headers: { cookie } });
    expect(await after.json()).toBeNull();
  });

  test("login accepts the password and rejects the wrong one", async () => {
    await signUp("login@example.dev");
    const wrong = await call("POST", "/api/auth/sign-in/email", {
      body: { email: "login@example.dev", password: "wrong-password" },
    });
    expect(wrong.status).toBe(401);
    const good = await call("POST", "/api/auth/sign-in/email", {
      body: { email: "login@example.dev", password: "longenough1" },
    });
    expect(good.status).toBe(200);
    expect(sessionCookie(good)).toContain("better-auth.session_token");
  });

  test("duplicate signup is refused", async () => {
    expect((await signUp("dupe@example.dev")).status).toBe(200);
    const second = await signUp("dupe@example.dev");
    expect(second.status).toBe(422);
  });

  test("password reset request never reveals whether the account exists", async () => {
    await signUp("reset@example.dev");
    const ghost = await call("POST", "/api/auth/request-password-reset", {
      body: { email: "ghost@example.dev", redirectTo: "/reset-password" },
    });
    const real = await call("POST", "/api/auth/request-password-reset", {
      body: { email: "reset@example.dev", redirectTo: "/reset-password" },
    });
    expect(ghost.status).toBe(200);
    expect(real.status).toBe(200);
  });

  test("resolves the legacy RUNS_DB binding (Cloudflare dev/prod)", async () => {
    const response = await app.fetch(
      new Request("https://edge.example/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "runs-db@example.dev", password: "longenough1", name: "R" }),
      }),
      { RUNS_DB: db as unknown as SqlDatabase } as Env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user?: { email?: string } };
    expect(body.user?.email).toBe("runs-db@example.dev");
  });

  test("profile updates change name and image", async () => {
    const created = await signUp("profile@example.dev");
    const cookie = sessionCookie(created);
    const updated = await call("POST", "/api/auth/update-user", {
      headers: { cookie },
      body: { name: "Ada Lovelace", image: "data:image/png;base64,iVBORw0KGgo=" },
    });
    expect(updated.status).toBe(200);

    const session = await call("GET", "/api/auth/get-session", { headers: { cookie } });
    const body = (await session.json()) as {
      user?: { name?: string; image?: string };
    } | null;
    expect(body?.user?.name).toBe("Ada Lovelace");
    expect(body?.user?.image).toBe("data:image/png;base64,iVBORw0KGgo=");

    // Clearing the avatar is allowed too.
    const cleared = await call("POST", "/api/auth/update-user", {
      headers: { cookie },
      body: { image: null },
    });
    expect(cleared.status).toBe(200);
    const afterClear = await call("GET", "/api/auth/get-session", { headers: { cookie } });
    const clearBody = (await afterClear.json()) as { user?: { image?: string | null } } | null;
    expect(clearBody?.user?.image ?? null).toBeNull();
  });

  test("accounts need a database", async () => {
    const response = await app.fetch(
      new Request("https://edge.example/api/auth/get-session"),
      {} as Env,
    );
    expect(response.status).toBe(501);
  });
});
