/**
 * Applied-once migrations for the sqlite driver, ledger style — the same
 * contract as `packages/runtime/scripts/migrate.ts` for Postgres and Alchemy's
 * D1 bookkeeping, so a file is applied exactly once per content hash.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlLikeDatabase } from "./index";

const LEDGER =
  "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))";

const isMigration = (file: string): boolean => /^\d{4}_[a-z0-9_]+\.sql$/.test(file);

/** Identity of a schema file: editing the file changes the version. */
export function sqliteSchemaVersion(file: string, sql: string): string {
  return `${file}:${createHash("sha256").update(sql).digest("hex").slice(0, 12)}`;
}

/** Applies every `NNNN_name.sql` in `dir` that the ledger does not know. */
export async function applySqliteMigrations(db: SqlLikeDatabase, dir: string): Promise<string[]> {
  db.prepare(LEDGER).run();
  const applied: string[] = [];
  const files = readdirSync(dir).filter(isMigration).sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    const version = sqliteSchemaVersion(file, sql);
    const seen = await db
      .prepare("SELECT 1 AS ok FROM schema_migrations WHERE version = ?")
      .bind(version)
      .first<{ ok: number }>();
    if (seen) continue;
    for (const statement of sql.split(";")) {
      if (statement.trim()) db.prepare(statement).bind().run();
    }
    db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").bind(version).run();
    applied.push(version);
  }
  return applied;
}
