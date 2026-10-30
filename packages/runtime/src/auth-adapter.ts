/**
 * Better Auth's database adapter over the runtime `SqlDatabase` port.
 *
 * One adapter serves D1, Postgres and SQLite: better-auth passes camelCase
 * field names, the port takes `?` placeholders, and the Postgres adapter
 * rewrites them. Inserts bind only the columns better-auth sent; selects use
 * quoted identifiers so `"user"` and `"session"` stay portable.
 *
 * `supportsBooleans/Dates/JSON: false` makes the factory store portable
 * primitives (0/1, ISO strings, JSON text) on every database.
 */
import {
  createAdapterFactory,
  type AdapterFactoryCustomizeAdapterCreator,
} from "better-auth/adapters";
import type { SqlDatabase } from "./ports";

type Where = {
  field: string;
  value: unknown;
  operator?: string;
  connector?: "AND" | "OR";
  mode?: "sensitive" | "insensitive";
};

const quote = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const isNullish = (value: unknown): boolean => value === null || value === undefined;

/** A parameterised WHERE clause, or an empty string for "match everything". */
export function whereSql(where: readonly Where[] | undefined): {
  sql: string;
  values: unknown[];
} {
  if (!where || where.length === 0) return { sql: "", values: [] };
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const [index, clause] of where.entries()) {
    const column = quote(clause.field);
    const operator = clause.operator ?? "eq";
    const insensitive = clause.mode === "insensitive" && typeof clause.value === "string";
    const lhs = insensitive ? `LOWER(${column})` : column;
    const value = insensitive ? String(clause.value).toLowerCase() : clause.value;
    let fragment: string;
    switch (operator) {
      case "in":
      case "not_in": {
        const list = Array.isArray(clause.value) ? clause.value : [];
        if (list.length === 0) fragment = operator === "in" ? "1 = 0" : "1 = 1";
        else {
          fragment = `${column} ${operator === "in" ? "IN" : "NOT IN"} (${list
            .map(() => "?")
            .join(", ")})`;
          values.push(...list);
        }
        break;
      }
      case "contains":
        fragment = `${lhs} LIKE ?`;
        values.push(`%${value}%`);
        break;
      case "starts_with":
        fragment = `${lhs} LIKE ?`;
        values.push(`${value}%`);
        break;
      case "ends_with":
        fragment = `${lhs} LIKE ?`;
        values.push(`%${value}`);
        break;
      case "ne":
        fragment = isNullish(clause.value) ? `${column} IS NOT NULL` : `${lhs} != ?`;
        if (!isNullish(clause.value)) values.push(value);
        break;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const symbols = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;
        fragment = `${column} ${symbols[operator]} ?`;
        values.push(clause.value);
        break;
      }
      default:
        fragment = isNullish(clause.value) ? `${column} IS NULL` : `${lhs} = ?`;
        if (!isNullish(clause.value)) values.push(value);
        break;
    }
    // Better Auth attaches the connector to the clause it joins with the
    // accumulated result; the first clause joins with nothing.
    if (index > 0) parts.push(clause.connector === "OR" ? "OR" : "AND");
    parts.push(fragment);
  }
  return { sql: `WHERE ${parts.join(" ")}`, values };
}

/** Projection list: `*`, or quoted columns in the order better-auth asked. */
export function selectSql(select: readonly string[] | undefined): string {
  if (!select || select.length === 0) return "*";
  return select.map(quote).join(", ");
}

export const sqlAuthAdapter = (db: SqlDatabase) =>
  createAdapterFactory({
    config: {
      adapterId: "edgespec-sql",
      adapterName: "EdgeSpec SQL",
      usePlural: false,
      supportsBooleans: false,
      supportsDates: false,
      supportsJSON: false,
      supportsArrays: false,
    },
    adapter: (({
      getFieldName,
    }: {
      getFieldName: (args: { model: string; field: string }) => string;
    }) => {
      const table = (model: string): string => quote(model);
      const field = (model: string, name: string): string =>
        quote(getFieldName({ model, field: name }));

      return {
        async create({ model, data }: { model: string; data: Record<string, unknown> }) {
          const columns = Object.keys(data);
          const sql = `INSERT INTO ${table(model)} (${columns
            .map((column) => field(model, column))
            .join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
          await db
            .prepare(sql)
            .bind(...columns.map((column) => data[column]))
            .run();
          return data;
        },

        async findOne({
          model,
          where,
          select,
        }: {
          model: string;
          where: Where[];
          select?: string[];
        }) {
          const clause = whereSql(where);
          const row = await db
            .prepare(`SELECT ${selectSql(select)} FROM ${table(model)} ${clause.sql} LIMIT 1`)
            .bind(...clause.values)
            .first<Record<string, unknown>>();
          return row ?? null;
        },

        async findMany({
          model,
          where,
          select,
          sortBy,
          limit,
          offset,
        }: {
          model: string;
          where?: Where[];
          select?: string[];
          sortBy?: { field: string; direction: "asc" | "desc" };
          limit?: number;
          offset?: number;
        }) {
          const clause = whereSql(where);
          const order = sortBy
            ? `ORDER BY ${quote(sortBy.field)} ${sortBy.direction === "desc" ? "DESC" : "ASC"}`
            : "";
          const page =
            limit === undefined && offset === undefined
              ? ""
              : `LIMIT ${limit ?? -1}${offset === undefined ? "" : ` OFFSET ${offset}`}`;
          const result = await db
            .prepare(
              `SELECT ${selectSql(select)} FROM ${table(model)} ${clause.sql} ${order} ${page}`.trim(),
            )
            .bind(...clause.values)
            .all<Record<string, unknown>>();
          return result.results ?? [];
        },

        async count({ model, where }: { model: string; where?: Where[] }) {
          const clause = whereSql(where);
          const row = await db
            .prepare(`SELECT COUNT(*) AS c FROM ${table(model)} ${clause.sql}`)
            .bind(...clause.values)
            .first<{ c: number }>();
          return Number(row?.c ?? 0);
        },

        async update({
          model,
          where,
          update,
        }: {
          model: string;
          where: Where[];
          update: Record<string, unknown>;
        }) {
          if (where.length === 0) return null;
          const columns = Object.keys(update);
          if (columns.length === 0) return null;
          const clause = whereSql(where);
          await db
            .prepare(
              `UPDATE ${table(model)} SET ${columns.map((column) => `${field(model, column)} = ?`).join(", ")} ${clause.sql}`,
            )
            .bind(...columns.map((column) => update[column]), ...clause.values)
            .run();
          const row = await db
            .prepare(`SELECT * FROM ${table(model)} ${clause.sql} LIMIT 1`)
            .bind(...clause.values)
            .first<Record<string, unknown>>();
          return row ?? null;
        },

        async updateMany({
          model,
          where,
          update,
        }: {
          model: string;
          where: Where[];
          update: Record<string, unknown>;
        }) {
          if (where.length === 0) return 0;
          const columns = Object.keys(update);
          const clause = whereSql(where);
          const result = await db
            .prepare(
              `UPDATE ${table(model)} SET ${columns.map((column) => `${field(model, column)} = ?`).join(", ")} ${clause.sql}`,
            )
            .bind(...columns.map((column) => update[column]), ...clause.values)
            .run();
          return result.meta?.changes ?? 0;
        },

        async delete({ model, where }: { model: string; where: Where[] }) {
          if (where.length === 0) return;
          const clause = whereSql(where);
          await db
            .prepare(`DELETE FROM ${table(model)} ${clause.sql}`)
            .bind(...clause.values)
            .run();
        },

        async deleteMany({ model, where }: { model: string; where: Where[] }) {
          if (where.length === 0) return 0;
          const clause = whereSql(where);
          const result = await db
            .prepare(`DELETE FROM ${table(model)} ${clause.sql}`)
            .bind(...clause.values)
            .run();
          return result.meta?.changes ?? 0;
        },
      };
    }) as unknown as AdapterFactoryCustomizeAdapterCreator,
  });
