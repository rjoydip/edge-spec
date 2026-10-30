/**
 * Two schemas, one shape. The D1 migrations and `migrations/postgres.sql` must
 * agree on every table and column, or a deployment silently loses history.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../../../migrations/", import.meta.url);
const read = (file: string): string => readFileSync(new URL(file, dir), "utf8");

function columns(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts
    .map((part) => part.trim().split(/\s+/)[0] ?? "")
    .filter((name) => name && !/^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|CHECK)$/i.test(name));
}

/** `CREATE TABLE` plus any later `ALTER TABLE … ADD COLUMN`. */
function schema(sql: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\);/g)) {
    tables.set(match[1] ?? "", columns(match[2] ?? ""));
  }
  for (const match of sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)) {
    const table = match[1] ?? "";
    tables.set(table, [...(tables.get(table) ?? []), match[2] ?? ""]);
  }
  return tables;
}

const d1 = schema(
  readdirSync(dir)
    .filter((file) => file.endsWith(".sql") && file !== "postgres.sql")
    .sort()
    .map((file) => read(file))
    .join("\n"),
);
const postgres = schema(read("postgres.sql"));

describe("postgres schema", () => {
  it("has the same tables as the D1 migrations", () => {
    expect([...postgres.keys()].sort()).toEqual([...d1.keys()].sort());
  });

  it("has every D1 column", () => {
    const missing = [...d1].flatMap(([table, names]) => {
      const remote = postgres.get(table) ?? [];
      return names.filter((name) => !remote.includes(name)).map((name) => `${table}.${name}`);
    });
    expect(missing).toEqual([]);
  });

  it("uses Postgres types, not SQLite syntax", () => {
    const sql = read("postgres.sql");
    expect(sql).not.toContain("AUTOINCREMENT");
    expect(sql).not.toContain("INSERT OR REPLACE");
    expect(sql).toContain("BIGSERIAL");
    expect(sql).toContain("DOUBLE PRECISION");
  });
});
