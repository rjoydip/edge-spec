/**
 * Architectural boundaries, as tests. One Hono app in `packages/runtime`,
 * vendor drivers in `packages/adapters` (+ `packages/db`, `packages/sandbox`),
 * and thin entries under `apps/*` / `infra/*`. Comments drift; these checks
 * fail when a driver sneaks back into the shared app or a package imports an
 * entry.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("../../../", import.meta.url)));

const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const source = (file: string): string => read(`packages/runtime/src/${file}`);

/** Every `.ts` file under `dir`, skipping build output and dependencies. */
function filesUnder(dir: string, extensions = [".ts"]): string[] {
  const out: string[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path)) {
      if (["node_modules", "dist", ".alchemy", ".git", "coverage"].includes(entry)) continue;
      const absolute = join(path, entry);
      const stats = statSync(absolute);
      if (stats.isDirectory()) walk(absolute);
      else if (extensions.some((extension) => entry.endsWith(extension))) {
        out.push(absolute.slice(ROOT.length).replaceAll("\\", "/"));
      }
    }
  };
  walk(join(ROOT, dir));
  return out;
}

const SHARED = [
  "app.ts",
  "auth.ts",
  "auth-adapter.ts",
  "device-flow.ts",
  "jobs.ts",
  "db.ts",
  "scheduled.ts",
  "artifacts.ts",
  "platform.ts",
  "env.ts",
  "ports.ts",
  "email.ts",
  "observability.ts",
];

/** Nothing platform-specific may appear in the shared app. */
const FORBIDDEN_IN_SHARED: Array<[RegExp, string]> = [
  [/from\s+["']cloudflare:workers["']/, "cloudflare:workers"],
  [/from\s+["']node:/, "node:"],
  [/from\s+["']pg["']/, "pg"],
  [/from\s+["']aws4fetch["']/, "aws4fetch"],
  [/from\s+["']@edge-spec\/adapters/, "@edge-spec/adapters"],
  [/Bun\.serve/, "Bun.serve"],
];

const ENTRY_EXPECTATIONS: Array<[file: string, marker: string]> = [
  ["apps/worker/src/index.ts", "fetch:"],
  ["apps/server/src/index.ts", "Bun.serve"],
  ["infra/vercel/handler.ts", "handler as GET"],
  ["infra/aws/lambda.ts", "export async function handler"],
];

describe("architecture boundaries", () => {
  it("keeps the shared app free of platform and adapter imports", () => {
    const hits = SHARED.flatMap((file) =>
      FORBIDDEN_IN_SHARED.filter(([pattern]) => pattern.test(source(file))).map(
        ([, label]) => `${file} imports ${label}`,
      ),
    );
    expect(hits).toEqual([]);
  });

  it("keeps runtime free of the adapters package", () => {
    const offenders = filesUnder("packages/runtime/src").filter(
      (file) => !file.includes("/test/") && /from\s+["']@edge-spec\/adapters/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps packages from importing entries", () => {
    const offenders = filesUnder("packages").filter((file) =>
      /from\s+["'][^"']*(apps|infra)\//.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("puts every Cloudflare runtime import in the Cloudflare adapters", () => {
    const hits = filesUnder("packages")
      .concat(filesUnder("apps"))
      .concat(filesUnder("infra"))
      .filter((file) => !file.includes("/test/"))
      .filter((file) => /from\s+["']cloudflare:workers["']/.test(read(file)));
    expect(hits.sort()).toEqual(["packages/adapters/src/cloudflare/workflow.ts"]);
    expect(read("packages/adapters/src/cloudflare/workflow.ts")).toContain(
      'from "cloudflare:workers"',
    );
  });

  it("keeps a listening socket out of the shared runtime", () => {
    const offenders = filesUnder("packages/runtime/src").filter((file) =>
      /Bun\.serve/.test(read(file)),
    );
    expect(offenders).toEqual([]);
    expect(read("apps/server/src/index.ts")).toContain("Bun.serve");
  });

  it("keeps apps/worker Cloudflare-only — no node or adapter drivers", () => {
    const worker = filesUnder("apps/worker/src").map(read);
    const forbidden = [/from\s+["']node:/, /from\s+["']pg["']/, /["']@edge-spec\/adapters\/node/];
    for (const text of worker) {
      for (const pattern of forbidden) expect(pattern.test(text)).toBe(false);
    }
  });

  it("keeps every deployment entry thin and real", () => {
    for (const [file, marker] of ENTRY_EXPECTATIONS) {
      const text = read(file);
      expect(text).toContain(marker);
      expect(text.split("\n").length).toBeLessThanOrEqual(80);
    }
  });

  it("keeps the drivers where the tests can see them", () => {
    // If these disappear the checks above pass vacuously.
    expect(read("packages/adapters/src/node/s3.ts")).toContain('"aws4fetch"');
    expect(read("packages/db/src/postgres.ts")).toContain('import("pg")');
    expect(read("packages/adapters/src/cloudflare/cache.ts")).toContain("KvBinding");
    expect(read("packages/adapters/src/node/select.ts")).toContain("resolveDatabase");
    expect(read("infra/vercel/handler.ts")).toContain("@edge-spec/adapters/node");
    expect(read("api/index.ts")).toContain("../infra/vercel/handler");
    // One Hono app: the entries all point at the same module.
    for (const [file] of ENTRY_EXPECTATIONS.filter(([f]) => f !== "apps/server/src/index.ts")) {
      expect(read(file)).toContain("@edge-spec/runtime/app");
    }
    expect(read("apps/server/src/index.ts")).toContain("@edge-spec/runtime/app");
  });
});
