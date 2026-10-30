/**
 * Repair Alchemy's `__alchemy_migrations` hashes.
 *
 * Alchemy records a `sha256` of each migration file and aborts a deploy when
 * a recorded hash no longer matches the file (`RewrittenMigrationHistoryError`).
 * Line endings alone cause this: the production cutover ran on Windows, where
 * `core.autocrlf=true` rewrote the `.sql` files to CRLF, so the recorded
 * hashes are CRLF-based while CI checks out LF and computes LF hashes.
 *
 * The repair is deliberately narrow. A stored hash is rewritten only when it
 * equals the CRLF hash of the same file -- that is provably line-ending drift,
 * not an edit. A hash that matches neither the LF nor the CRLF hash means the
 * migration was genuinely rewritten, and is left alone so Alchemy keeps
 * rejecting it. Only the bookkeeping hash changes: the schema is untouched
 * and no migration is re-run.
 *
 *   bun scripts/fix-migration-hashes.ts [database] [--print]
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dir = join(root, "migrations");
const database = process.argv[2] ?? "edge-spec-runs";
const printOnly = process.argv.includes("--print");
const table = "__alchemy_migrations";

const sha256 = (sql: string) => createHash("sha256").update(sql).digest("hex");

// Alchemy hashes the file it reads. CI checks out LF, so LF is the hash the
// deploy will compare against; CRLF is the hash a Windows checkout produces.
const migrations = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => {
    const lf = readFileSync(join(dir, name), "utf8").replace(/\r\n/g, "\n");
    return { name, lf: sha256(lf), crlf: sha256(lf.replace(/\n/g, "\r\n")) };
  });
if (migrations.length === 0) throw new Error(`no .sql files in ${dir}`);

const sql = (rows: { name: string; to: string }[]) =>
  rows
    .map(({ name, to }) => `UPDATE ${table} SET hash = '${to}' WHERE name = '${name}';`)
    .join("\n");

if (printOnly) {
  console.log(
    sql(migrations.map(({ name, lf }) => ({ name, to: lf }))),
    "\n# hashes above are the LF hashes CI computes; review before applying.",
  );
  process.exit(0);
}

/**
 * Extract the JSON payload from wrangler's stdout.
 *
 * `--json` makes the payload structured, but `bunx` can print installer lines
 * such as `[Scripts] Starting scripts for "workerd"` on the same stream before
 * the command runs (fresh CI cache). Searching for the first bracket picks
 * those lines up and throws `JSON Parse error`. Try every line that starts
 * with `{` or `[` instead, so the payload wins.
 */
const parseWranglerJson = (raw: string): unknown => {
  for (const match of raw.matchAll(/^[ \t]*[[{]/gm)) {
    if (match.index === undefined) continue;
    try {
      return JSON.parse(raw.slice(match.index));
    } catch {
      // A bunx log line, not the payload.
    }
  }
  return undefined;
};

/** Read the hashes Alchemy recorded, whatever shape wrangler prints them in. */
const readStored = async () => {
  const proc = Bun.spawn(
    [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      database,
      "--remote",
      "--json",
      `--command=SELECT name, hash FROM ${table};`,
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const raw = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) return undefined;

  const parsed = parseWranglerJson(raw);
  if (parsed === undefined) {
    throw new Error(`Could not parse wrangler output for ${database}:\n${raw}`);
  }

  const stored = new Map<string, string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    if (typeof row.name === "string" && typeof row.hash === "string") {
      stored.set(row.name, row.hash);
      return;
    }
    Object.values(row).forEach(visit);
  };
  visit(parsed);
  return stored;
};

const stored = await readStored();
if (stored === undefined) {
  // A brand new account has no database yet, and any other D1 problem
  // surfaces from the deploy itself. Nothing to repair either way.
  console.log(`Could not read ${database}.${table}; skipping the migration repair.`);
  process.exit(0);
}
const drift = migrations.filter((m) => stored.get(m.name) === m.crlf);
const rewritten = migrations.filter((m) => {
  const current = stored.get(m.name);
  return current !== undefined && current !== m.lf && current !== m.crlf;
});

for (const { name } of rewritten) {
  console.error(
    `::error::${name} was rewritten after it was applied. Add a new forward migration instead.`,
  );
}
if (rewritten.length > 0) {
  console.error("Leaving those migrations alone; Alchemy will reject the deploy.");
  process.exit(1);
}

if (drift.length === 0) {
  console.log(`Migration bookkeeping in ${database}.${table} is up to date.`);
  process.exit(0);
}

const out = join(root, ".alchemy", "fix-migration-hashes.sql");
mkdirSync(join(root, ".alchemy"), { recursive: true });
writeFileSync(out, `${sql(drift.map(({ name, lf }) => ({ name, to: lf })))}\n`);

console.log(`Repairing ${drift.length} migration hash(es) in ${database}.${table}:`);
for (const { name, crlf, lf } of drift) {
  console.log(`  ${name}\n    was ${crlf}\n    now ${lf}`);
}

const proc = Bun.spawn(
  ["bunx", "wrangler", "d1", "execute", database, "--remote", `--file=${out}`],
  { stdout: "inherit", stderr: "inherit" },
);
process.exit(await proc.exited);
