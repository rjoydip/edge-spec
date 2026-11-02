/**
 * @edge-spec/db — the SQL adapter package, one entry for every runtime.
 *
 * Driver selection mirrors the runtime's capability ladder:
 *
 *   binding (Cloudflare D1) → EDGESPEC_DB override → provider default → off
 *
 *   | driver    | runtime        | backing library        |
 *   | --------- | -------------- | ---------------------- |
 *   | d1        | Cloudflare     | the D1 binding itself  |
 *   | postgres  | node providers | `pg` (transactional)   |
 *   | sqlite    | node (Bun dev) | Bun's built-in sqlite  |
 *
 * Every driver speaks the same structural surface as the runtime's
 * `SqlDatabase` port (prepare → bind → first/all/run, plus batch), so callers
 * never see which file backed the query. db0 is the connector layer for the
 * sqlite family; Postgres keeps a hand-rolled adapter because `batch` needs a
 * real transaction around mixed statements, which db0 does not provide.
 */

/** Mirrors the runtime's `SqlStatement` port, structurally. */
export interface SqlLikeStatement {
  bind(...values: unknown[]): SqlLikeStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

/** Mirrors the runtime's `SqlDatabase` port, structurally. */
export interface SqlLikeDatabase {
  prepare(query: string): SqlLikeStatement;
  batch<T = unknown>(statements: SqlLikeStatement[]): Promise<T[]>;
}

export type DatabaseDriver = "d1" | "postgres" | "sqlite";

export interface DatabaseBinding {
  /** A D1 binding under either its neutral or legacy name. */
  readonly DB?: SqlLikeDatabase;
  readonly RUNS_DB?: SqlLikeDatabase;
}

export interface DatabaseSource {
  EDGESPEC_DB?: string;
  EDGESPEC_DB_URL?: string;
  EDGESPEC_PROVIDER?: string;
}

export interface ResolvedDatabase {
  db: SqlLikeDatabase;
  driver: DatabaseDriver;
}

import { createPostgres } from "./postgres";
import { createSqlite } from "./sqlite";

const DRIVER_NAMES = new Set<DatabaseDriver>(["d1", "postgres", "sqlite"]);

const DRIVER_HELP =
  "Use d1, postgres or sqlite. d1 needs the DB/RUNS_DB binding; postgres and sqlite need EDGESPEC_DB_URL.";

/**
 * Driver resolution, shared by every non-Cloudflare runtime:
 *
 *   binding (D1) → EDGESPEC_DB override → provider default → off. An explicit
 *   override whose env is missing throws; a provider default whose env is
 *   missing stays off, so a partial deployment still starts honestly.
 *
 * The Cloudflare entry never imports this file — its D1 is a binding wired by
 * `infra/cloudflare/cloudflare.run.ts`.
 */
export async function resolveDatabase(
  bindings: DatabaseBinding,
  source: DatabaseSource,
): Promise<ResolvedDatabase | undefined> {
  const existing = bindings.DB ?? bindings.RUNS_DB;
  if (existing) return { db: existing, driver: "d1" };

  const explicit = source.EDGESPEC_DB?.trim().toLowerCase() as DatabaseDriver | undefined;
  if (explicit && !DRIVER_NAMES.has(explicit)) {
    throw new Error(`Unknown EDGESPEC_DB adapter "${source.EDGESPEC_DB}". ${DRIVER_HELP}`);
  }
  if (explicit === "d1") {
    throw new Error("EDGESPEC_DB=d1 requires the DB or RUNS_DB binding.");
  }

  const driver =
    explicit ??
    (source.EDGESPEC_PROVIDER?.trim().toLowerCase() ? ("postgres" as DatabaseDriver) : undefined);
  if (!driver) return undefined;

  const url = source.EDGESPEC_DB_URL?.trim();
  if (driver === "postgres") {
    // A provider default missing its URL just leaves SQL off, matching the
    // rest of the ladder; only an explicit override throws.
    if (!url) {
      if (explicit) throw new Error("EDGESPEC_DB=postgres requires EDGESPEC_DB_URL.");
      return undefined;
    }
    return { db: await createPostgres(url), driver };
  }
  return { db: createSqlite({ path: url || ".data/edge-spec.sqlite" }), driver };
}

export { placeholders, createPostgres } from "./postgres";
export { createSqlite } from "./sqlite";
export { applySqliteMigrations, sqliteSchemaVersion } from "./migrate-sqlite";
