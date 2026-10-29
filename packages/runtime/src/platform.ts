import type { CacheDriver, Env } from "./env";

/** Resolve a capability through the neutral name, then the legacy binding. */
export const historyDb = (env: Env) => env.DB ?? env.RUNS_DB;
export const artifactsStore = (env: Env) => env.BLOB ?? env.ARTIFACTS;
export const jobsQueue = (env: Env) => env.JOBS ?? env.TEST_GENERATION_WORKFLOW;
export const cacheStore = (env: Env) => env.CACHE;

export interface Capabilities {
  history: boolean;
  artifacts: boolean;
  jobs: "cloudflare-workflows" | "external" | "none";
  durableJobs: boolean;
  cache: CacheDriver | "none";
  cron: boolean;
  ai: "binding" | "env" | "byok-only";
  assets: boolean;
}

/**
 * What this deployment actually has. The dashboard reads this instead of
 * guessing from a Cloudflare binding name.
 */
export function capabilities(env: Env): Capabilities {
  const jobs = env.JOBS
    ? "external"
    : env.TEST_GENERATION_WORKFLOW
      ? "cloudflare-workflows"
      : "none";
  const cache = env.CACHE ? (env.CACHE_DRIVER ?? "kv") : "none";
  return {
    history: Boolean(historyDb(env)),
    artifacts: Boolean(artifactsStore(env)),
    jobs,
    durableJobs: jobs === "cloudflare-workflows" || env.JOBS_DURABLE === "true",
    cache,
    cron: Boolean(env.CRON_SECRET?.trim()),
    ai: env.AI ? "binding" : env.AI_KEY ? "env" : "byok-only",
    assets: Boolean(env.ASSETS),
  };
}
