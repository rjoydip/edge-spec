/**
 * PostgreSQL over `pg`. Node/Bun only: the module is imported lazily and this
 * file must never be reachable from the Cloudflare entry.
 */
import type { SqlDatabase, SqlStatement } from "../env";

interface PgResult {
  rows: unknown[];
  rowCount: number | null;
}

interface PgClient {
  query(text: string, values?: unknown[]): Promise<PgResult>;
  release(): void;
}

interface PgPool {
  query(text: string, values?: unknown[]): Promise<PgResult>;
  connect(): Promise<PgClient>;
}

interface PgModule {
  default: { Pool: new (config: { connectionString: string; max?: number }) => PgPool };
}

/** Replaces `?` with `$1…`, leaving quoted strings and comments alone. */
export function placeholders(sql: string): string {
  let out = "";
  let index = 0;
  let parameter = 0;
  let quote: "'" | '"' | "`" | null = null;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (quote) {
      out += char;
      if (char === quote) {
        if (next === quote) {
          out += next;
          index += 2;
          continue;
        }
        quote = null;
      }
      index += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", index);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(index, stop);
      index = stop;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(index, stop);
      index = stop;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === "?") {
      parameter += 1;
      out += `$${parameter}`;
      index += 1;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

class PostgresStatement implements SqlStatement {
  constructor(
    private readonly pool: PgPool,
    readonly text: string,
    readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): SqlStatement {
    return new PostgresStatement(this.pool, this.text, values);
  }

  async first<T = unknown>(): Promise<T | null> {
    const result = await this.pool.query(placeholders(this.text), this.values);
    return (result.rows[0] as T | undefined) ?? null;
  }

  async all<T = unknown>(): Promise<{ results?: T[] }> {
    const result = await this.pool.query(placeholders(this.text), this.values);
    return { results: result.rows as T[] };
  }

  async run(): Promise<{ meta?: { changes?: number } }> {
    const result = await this.pool.query(placeholders(this.text), this.values);
    return { meta: { changes: result.rowCount ?? 0 } };
  }
}

export async function createPostgres(url: string): Promise<SqlDatabase> {
  const { default: pg } = (await import("pg")) as unknown as PgModule;
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return {
    prepare(query: string) {
      return new PostgresStatement(pool, query);
    },
    async batch<T = unknown>(statements: SqlStatement[]): Promise<T[]> {
      if (statements.length === 0) return [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const results: T[] = [];
        for (const statement of statements) {
          if (!(statement instanceof PostgresStatement)) {
            throw new Error("A batch cannot mix statement adapters.");
          }
          const result = await client.query(placeholders(statement.text), statement.values);
          results.push(result as T);
        }
        await client.query("COMMIT");
        return results;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
