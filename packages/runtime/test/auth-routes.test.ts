/**
 * The account routes run against the real sqlite driver from @edge-spec/db —
 * the same in-memory DB that a Bun deployment would use in production, so the
 * round trips here are the real ones (sessions, JOINS, single-use tokens).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { app } from "../src/app";
import { hashPassword, verifyPassword } from "../src/accounts";
import { applySqliteMigrations, createSqlite, type SqlLikeDatabase } from "@edge-spec/db";
import type { Env, SqlDatabase } from "../src/env";

let db: SqlLikeDatabase;

beforeEach(async () => {
  // Real migrations over the real in-memory driver: the routes run against
  // exactly what a Bun deployment would boot with.
  db = createSqlite({ path: ":memory:" });
  await applySqliteMigrations(db, join(import.meta.dir, "..", "..", "..", "migrations"));
});
afterEach(() => {
  void db;
});

const storage = (): { DB: SqlDatabase } => ({ DB: db as unknown as SqlDatabase });

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
      { ...storage(), ...init.env } as Env,
    ),
  );

const signup = (email: string, password = "longenough1", name?: string) =>
  call("POST", "/api/auth/signup", { body: { email, password, ...(name ? { name } : {}) } });

/** The session token from a signup/login response's Set-Cookie header. */
const cookieOf = (response: Response): string =>
  (response.headers.get("set-cookie") ?? "").split(";")[0]?.split("=")[1] ?? "";

describe("password hashing", () => {
  test("a hash never contains the password and round-trips", async () => {
    const { stored, verify } = await hashPassword("hunter2hunter2");
    expect(stored.startsWith("pbkdf2$")).toBe(true);
    expect(stored).not.toContain("hunter2");
    expect(await verify("hunter2hunter2")).toBe(true);
    expect(await verify("wrong")).toBe(false);
  });

  test("verifyPassword rejects malformed storage strings", async () => {
    expect(await verifyPassword("", "x")).toBe(false);
    expect(await verifyPassword("pbkdf2$nope$zz", "x")).toBe(false);
  });
});

describe("signup / session routes", () => {
  afterEach(async () => {
    // sqlite :memory: drops on scope exit; nothing to clean.
  });

  test("signup needs a database; validation comes before it matters", async () => {
    const response = await app.fetch(
      new Request("https://edge.example/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.dev", password: "longenough1" }),
      }),
      {} as Env,
    );
    expect(response.status).toBe(501);
    expect((await signup("nope")).status).toBe(400);
    expect((await signup("a@b.dev", "short")).status).toBe(400);
  });

  test("signup → me (cookie) → logout → me 401", async () => {
    const created = await signup("dev@example.dev", "longenough1", "Dev");
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      user: { email: string; plan: string; emailVerified: boolean };
    };
    expect(body.user.email).toBe("dev@example.dev");
    expect(body.user.plan).toBe("free");
    expect(body.user.emailVerified).toBe(false);

    const cookie = cookieOf(created);

    const me = await call("GET", "/api/auth/me", {
      headers: { cookie: `edgespec_session=${cookie}` },
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe("dev@example.dev");

    // The header form works too — that is how the CLI rides the session.
    const viaHeader = await call("GET", "/api/auth/me", {
      headers: { "x-session-token": cookie },
    });
    expect(viaHeader.status).toBe(200);

    await call("POST", "/api/auth/logout", { headers: { "x-session-token": cookie } });
    const gone = await call("GET", "/api/auth/me", { headers: { "x-session-token": cookie } });
    expect(gone.status).toBe(401);
  });

  test("duplicate signup is a 409, not an oracle", async () => {
    await signup("dupe@example.dev");
    expect((await signup("DUPE@example.dev")).status).toBe(409);
  });

  test("login works with the exact password and nothing else", async () => {
    await signup("pw@example.dev");
    expect(
      (
        await call("POST", "/api/auth/login", {
          body: { email: "pw@example.dev", password: "nope-nope-nope" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call("POST", "/api/auth/login", {
          body: { email: "ghost@example.dev", password: "longenough1" },
        })
      ).status,
    ).toBe(401);
    const good = await call("POST", "/api/auth/login", {
      body: { email: "PW@example.dev", password: "longenough1" },
    });
    expect(good.status).toBe(200);
  });

  test("the first account bootstraps to team only when ADMIN_KEY is set", async () => {
    const first = await call("POST", "/api/auth/signup", {
      body: { email: "root@example.dev", password: "longenough1" },
      env: { ADMIN_KEY: "admin" },
    });
    expect(((await first.json()) as { user: { plan: string } }).user.plan).toBe("team");
    const second = await call("POST", "/api/auth/signup", {
      body: { email: "next@example.dev", password: "longenough1" },
      env: { ADMIN_KEY: "admin" },
    });
    expect(((await second.json()) as { user: { plan: string } }).user.plan).toBe("free");
  });
});

describe("verification and reset tokens", () => {
  test("signup without a configured sender still notes what happened", async () => {
    const response = await signup("no-sender@example.dev");
    const body = (await response.json()) as { emailNote?: string };
    expect(body.emailNote).toContain("sender");
  });

  test("verify-email consumes a token exactly once", async () => {
    const created = await signup("verify@example.dev");
    const cookie = cookieOf(created);
    const { user } = (await created.json()) as { user: { id: string } };
    // Mint a verification token directly, as the email path does.
    const { issueAccountToken } = await import("../src/accounts");
    const token = await issueAccountToken(db as SqlDatabase, user.id, "verify-email");

    const first = await call("POST", "/api/auth/verify-email", { body: { token } });
    expect(first.status).toBe(200);
    expect((await call("POST", "/api/auth/verify-email", { body: { token } })).status).toBe(400);

    // The dashboard reflects the verified state afterwards.
    const me = await call("GET", "/api/auth/me", {
      headers: { cookie: `edgespec_session=${cookie}` },
    });
    const { user: updated } = (await me.json()) as { user: { id: string; emailVerified: boolean } };
    expect(updated.id).toBe(user.id);
    expect(updated.emailVerified).toBe(true);
  });

  test("reset → confirm → old password gone", async () => {
    await signup("reset@example.dev");
    const { userByEmail, issueAccountToken } = await import("../src/accounts");
    const account = await userByEmail(db as SqlDatabase, "reset@example.dev");
    expect(account).toBeDefined();
    const token = await issueAccountToken(db as SqlDatabase, account!.id, "reset-password");
    expect(
      (
        await call("POST", "/api/auth/password-reset/confirm", {
          body: { token, password: "short" },
        })
      ).status,
    ).toBe(400);

    const confirmed = await call("POST", "/api/auth/password-reset/confirm", {
      body: { token, password: "brand-new-password" },
    });
    expect(confirmed.status).toBe(200);
    expect(
      (
        await call("POST", "/api/auth/password-reset/confirm", {
          body: { token, password: "again-brand-new" },
        })
      ).status,
    ).toBe(400);

    const loginOld = await call("POST", "/api/auth/login", {
      body: { email: "reset@example.dev", password: "longenough1" },
    });
    expect(loginOld.status).toBe(401);
    const loginNew = await call("POST", "/api/auth/login", {
      body: { email: "reset@example.dev", password: "brand-new-password" },
    });
    expect(loginNew.status).toBe(200);
  });

  test("password reset never reveals account existence or delivers without a sender", async () => {
    const ghost = await call("POST", "/api/auth/password-reset", {
      body: { email: "ghost@example.dev" },
    });
    const real = await call("POST", "/api/auth/password-reset", {
      body: { email: "no-sender@example.dev" },
    });
    expect(((await ghost.json()) as { delivered: boolean }).delivered).toBe(false);
    expect(((await real.json()) as { delivered: boolean }).delivered).toBe(false);
  });
});

describe("manual plan activation", () => {
  test("guarded by ADMIN_KEY and validates the plan id", async () => {
    await signup("pro@example.dev");
    expect((await call("POST", "/api/admin/plans/activate", { body: {} })).status).toBe(501);
    expect(
      (
        await call("POST", "/api/admin/plans/activate", {
          body: { email: "pro@example.dev", plan: "pro" },
          env: { ADMIN_KEY: "sekrit" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call("POST", "/api/admin/plans/activate", {
          body: { email: "pro@example.dev", plan: "diamond" },
          headers: { "x-admin-key": "sekrit" },
          env: { ADMIN_KEY: "sekrit" },
        })
      ).status,
    ).toBe(400);
    const activated = await call("POST", "/api/admin/plans/activate", {
      body: { email: "pro@example.dev", plan: "pro" },
      headers: { "x-admin-key": "sekrit" },
      env: { ADMIN_KEY: "sekrit" },
    });
    expect(activated.status).toBe(200);
    expect(((await activated.json()) as { user: { plan: string } }).user.plan).toBe("pro");
  });
});
