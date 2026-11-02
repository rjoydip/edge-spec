import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applySqliteMigrations, createSqlite, resolveDatabase, type SqlLikeDatabase } from "../src";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations-fixture");

beforeEach(() => {
  rmSync(MIGRATIONS_DIR, { recursive: true, force: true });
  mkdirSync(MIGRATIONS_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(MIGRATIONS_DIR, { recursive: true, force: true });
});

describe("sqlite driver", () => {
  let db: SqlLikeDatabase;

  beforeEach(() => {
    db = createSqlite({ path: ":memory:" });
  });

  test("prepare → bind → first/all/run round trips", async () => {
    db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)").run();
    db.prepare("INSERT INTO t (name) VALUES (?)").bind("alpha").run();
    db.prepare("INSERT INTO t (name) VALUES (?)").bind("beta").run();

    const one = await db
      .prepare("SELECT name FROM t WHERE id = ?")
      .bind(1)
      .first<{ name: string }>();
    expect(one?.name).toBe("alpha");

    const rows = await db.prepare("SELECT name FROM t ORDER BY id").all<{ name: string }>();
    expect(rows.results).toEqual([{ name: "alpha" }, { name: "beta" }]);

    const deleted = await db.prepare("DELETE FROM t WHERE id = 2").run();
    expect(deleted.meta?.changes).toBe(1);

    const empty = await db.prepare("SELECT name FROM t WHERE id = 99").first();
    expect(empty).toBeNull();
  });

  test("batch runs every statement", async () => {
    db.prepare("CREATE TABLE t (id INTEGER)").run();
    await db.batch([
      db.prepare("INSERT INTO t (id) VALUES (1)").bind(1),
      db.prepare("INSERT INTO t (id) VALUES (2)").bind(2),
    ]);
    const rows = await db.prepare("SELECT count(*) AS c FROM t").first<{ c: number }>();
    expect(rows?.c).toBe(2);
  });
});

describe("sqlite migrations", () => {
  test("applies once per file, idempotent", async () => {
    writeFileSync(
      join(MIGRATIONS_DIR, "0001_users.sql"),
      "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)",
    );
    writeFileSync(
      join(MIGRATIONS_DIR, "0002_flags.sql"),
      "CREATE TABLE IF NOT EXISTS flags (name TEXT)",
    );

    const db = createSqlite({ path: ":memory:" });
    expect(await applySqliteMigrations(db, MIGRATIONS_DIR)).toHaveLength(2);
    // Idempotent: a second boot applies nothing.
    expect(await applySqliteMigrations(db, MIGRATIONS_DIR)).toHaveLength(0);

    // Editing a file re-runs it (same contract as the postgres ledger).
    writeFileSync(
      join(MIGRATIONS_DIR, "0002_flags.sql"),
      "CREATE TABLE IF NOT EXISTS flags (name TEXT, more TEXT)",
    );
    expect(await applySqliteMigrations(db, MIGRATIONS_DIR)).toHaveLength(1);
  });

  test("ignores files that are not NNNN_name.sql", async () => {
    writeFileSync(join(MIGRATIONS_DIR, "README.md"), "nope");
    const applied = await applySqliteMigrations(createSqlite({ path: ":memory:" }), MIGRATIONS_DIR);
    expect(applied).toHaveLength(0);
  });
});

describe("resolveDatabase", () => {
  test("binding wins with driver d1", async () => {
    const fake = createSqlite({ path: ":memory:" }) as SqlLikeDatabase;
    const resolved = await resolveDatabase({ DB: fake }, {});
    expect(resolved?.driver).toBe("d1");
  });

  test("sqlite from the env, default path", async () => {
    const resolved = await resolveDatabase({}, { EDGESPEC_DB: "sqlite" });
    expect(resolved?.driver).toBe("sqlite");
  });

  test("provider defaults to postgres, silent off without a URL; an override throws", async () => {
    expect(
      await resolveDatabase({}, { EDGESPEC_PROVIDER: "vercel", EDGESPEC_DB_URL: "" }),
    ).toBeUndefined();
    await expect(resolveDatabase({}, { EDGESPEC_DB: "postgres" })).rejects.toThrow(
      "requires EDGESPEC_DB_URL",
    );
    await expect(
      resolveDatabase({}, { EDGESPEC_DB: "d1-nope", EDGESPEC_DB_URL: "" }),
    ).rejects.toThrow("Unknown EDGESPEC_DB adapter");
  });

  test("off when nothing asks for a database", async () => {
    expect(await resolveDatabase({}, {})).toBeUndefined();
  });
});
