/**
 * The plan's acceptance criterion #1: the shared modules must stay runnable on
 * any host, and `apps/worker` must stay Cloudflare-only. A test, not a comment,
 * keeps `pg`, `aws4fetch` and Workers bindings on the right side of the line.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const source = (file: string): string =>
  readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

/** Files outside `packages/runtime`, relative to the repository root. */
const repoSource = (file: string): string =>
  readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

/** Every host imports these; none of them may know which host it runs on. */
const SHARED = [
  "app.ts",
  "jobs.ts",
  "db.ts",
  "scheduled.ts",
  "artifacts.ts",
  "platform.ts",
  "env.ts",
];

const FORBIDDEN = [
  /from\s+["']cloudflare:workers["']/,
  /from\s+["']node:/,
  /from\s+["']\.\/adapters\//,
  /from\s+["']pg["']/,
  /from\s+["']aws4fetch["']/,
];

/** The entire Cloudflare app: entry, Workflow adapter and the KV cache. */
const CLOUDFLARE_ONLY = ["index.ts", "workflow.ts", "kv.ts"];

const FORBIDDEN_IN_WORKER = [
  /from\s+["']node:/,
  /from\s+["']pg["']/,
  /from\s+["']aws4fetch["']/,
  /from\s+["']@edge-spec\/app\/adapters\/(select|node|postgres|s3|redis|http-jobs|memory-cache)["']/,
];

describe("portability", () => {
  it("keeps runtime imports out of the shared modules", () => {
    const hits = SHARED.flatMap((file) =>
      FORBIDDEN.filter((pattern) => pattern.test(source(file))).map(
        (pattern) => `${file} imports ${pattern}`,
      ),
    );
    expect(hits).toEqual([]);
  });

  it("keeps apps/worker Cloudflare-only", () => {
    const hits = CLOUDFLARE_ONLY.flatMap((file) =>
      FORBIDDEN_IN_WORKER.filter((pattern) =>
        pattern.test(repoSource(`apps/worker/src/${file}`)),
      ).map((pattern) => `${file} imports ${pattern}`),
    );
    expect(hits).toEqual([]);
    expect(repoSource("apps/worker/src/workflow.ts")).toContain('"cloudflare:workers"');
  });

  it("keeps the runtime imports in the entries and adapters", () => {
    // If these disappear the test above would pass vacuously.
    expect(source("server.ts")).toContain('"node:path"');
    expect(repoSource("infra/vercel/handler.ts")).toContain("adapters/node");
    expect(repoSource("api/index.ts")).toContain("../infra/vercel/handler");
    expect(source("adapters/postgres.ts")).toContain('import("pg")');
    expect(source("adapters/s3.ts")).toContain('"aws4fetch"');
  });
});
