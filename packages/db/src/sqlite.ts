/**
 * SQLite over db0's Bun connector. Bun ships a native sqlite — no dependency,
 * just a file. Used for self-hosted single-node deployments and local dev.
 */
import { createDatabase } from "db0";
import bunSqlite from "db0/connectors/bun-sqlite";
import type { SqlLikeDatabase, SqlLikeStatement } from "./index";

/** db0 statements: bind → all/run/get; the port wants first/all/run shapes. */
function adapt(statement: {
  bind(...values: unknown[]): unknown;
  all(): Promise<unknown[]>;
  run(): Promise<{ changes?: number; success?: boolean }>;
  get(): Promise<unknown>;
}): SqlLikeStatement {
  return {
    bind(...values: unknown[]) {
      return adapt(statement.bind(...values) as typeof statement);
    },
    async first<T = unknown>(): Promise<T | null> {
      const row = (await statement.get()) as T | undefined;
      return row ?? null;
    },
    async all<T = unknown>(): Promise<{ results?: T[] }> {
      return { results: (await statement.all()) as T[] };
    },
    async run() {
      const result = await statement.run();
      return { meta: { changes: result.changes ?? 0 } };
    },
  };
}

export function createSqlite(options: { path: string }): SqlLikeDatabase {
  const db = createDatabase(bunSqlite({ name: options.path }));
  return {
    prepare(query: string) {
      return adapt(db.prepare(query));
    },
    async batch<T = unknown>(statements: SqlLikeStatement[]): Promise<T[]> {
      const results: T[] = [];
      for (const statement of statements) results.push(await (statement.run() as Promise<T>));
      return results;
    },
  };
}
