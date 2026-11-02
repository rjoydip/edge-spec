import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** The slice of `pg.Client` the migration needs, so a fake can stand in. */
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

const LEDGER = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;

/**
 * A schema file's identity. Editing the file changes the version, so the
 * idempotent DDL runs again instead of being skipped by the ledger.
 */
export function schemaVersion(file: string, sql: string): string {
  return `${file}:${createHash("sha256").update(sql).digest("hex").slice(0, 12)}`;
}

/** Applies `sql` once per version. Returns false when the ledger already has it. */
export async function applySchema(
  client: SqlClient,
  version: string,
  sql: string,
): Promise<boolean> {
  await client.query(LEDGER);
  const { rows } = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [
    version,
  ]);
  if (rows.length > 0) return false;

  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return true;
}

if (import.meta.main) {
  const url = process.env.EDGESPEC_DB_URL?.trim();
  if (!url) {
    console.error("Set EDGESPEC_DB_URL to the Postgres connection string.");
    process.exit(1);
  }

  // Postgres mirrors the D1 migrations: the base schema, then every forward
  // migration that ships its own portable DDL. Files applied here must stay
  // immutable; the ledger records `<file>:<hash>`. New changes go in a new file.
  const files = ["postgres.sql", "0010_better_auth.sql", "0011_drop_pricing_plan.sql"];
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const file of files) {
      const sql = readFileSync(
        fileURLToPath(new URL(`../../../migrations/${file}`, import.meta.url)),
        "utf8",
      );
      const version = schemaVersion(file, sql);
      const applied = await applySchema(client, version, sql);
      console.log(applied ? `Applied ${file} (${version})` : `${file} is already applied.`);
    }
  } finally {
    await client.end();
  }
}
