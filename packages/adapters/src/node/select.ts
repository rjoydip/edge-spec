/**
 * The adapter selector. One switch, no registry: every capability resolves
 * through
 *
 *   binding -> EDGESPEC_<CAP> override -> EDGESPEC_PROVIDER default -> off
 *
 * An explicit override whose env is missing fails at boot. A provider default
 * whose env is missing just leaves that capability off, so a partial
 * deployment still starts and reports honestly.
 */
import type { Env } from "@edge-spec/runtime/env";
import { httpJobs } from "./http-jobs";
import { memoryCache } from "./memory-cache";
import { redisCache } from "./redis";
import { s3Store } from "./s3";
import { resolveDatabase, applySqliteMigrations } from "@edge-spec/db";

type Source = Record<string, string | undefined>;

const PROVIDERS = new Set(["vercel", "aws", "node"]);

/** Env vars that are copied straight through to `Env`. */
const PASSTHROUGH = [
  "CRON_SECRET",
  "JOBS_DURABLE",
  "GH_TOKEN",
  "GH_APP_ID",
  "GH_APP_PRIVATE_KEY",
  "GH_WEBHOOK_SECRET",
  "SANDBOX_RUNNER_URL",
  "SANDBOX_API_KEY",
  "AI_PROVIDER",
  "AI_KEY",
  "AI_BASE_URL",
  "AI_MODEL",
  "DRIFT_ALERT_WEBHOOK_URL",
  "DRIFT_ALERT_WEBHOOK_SECRET",
  "EMAIL_API_KEY",
  "EMAIL_FROM",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "EDGESPEC_INSECURE_COOKIES",
  "EDGESPEC_WORKSPACE_URL",
  "EDGESPEC_OBSERVABILITY",
  "EDGESPEC_LOG_LEVEL",
  "EDGESPEC_SERVICE_NAME",
  "EDGESPEC_ENV",
  "NODE_ENV",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "SENTRY_DSN",
  "AXIOM_TOKEN",
  "AXIOM_DATASET",
  "AXIOM_URL",
] as const;

const value = (source: Source, key: string): string | undefined => {
  const raw = source[key]?.trim();
  return raw ? raw : undefined;
};

export async function createPlatform(bindings: Partial<Env>, source: Source): Promise<Env> {
  const provider = value(source, "EDGESPEC_PROVIDER")?.toLowerCase();
  if (provider && !PROVIDERS.has(provider)) {
    throw new Error(
      `Unknown EDGESPEC_PROVIDER "${provider}". Use vercel, aws or node, or leave it unset.`,
    );
  }

  const env: Env = { ...bindings };
  for (const key of PASSTHROUGH) {
    const raw = value(source, key);
    if (raw !== undefined) (env as Record<string, unknown>)[key] = raw;
  }

  // SQL: D1 only exists as a binding; the node drivers resolve via @edge-spec/db.
  const resolved = await resolveDatabase(env, source);
  if (resolved) {
    env.DB = resolved.db as Env["DB"];
    if (resolved.driver === "sqlite") {
      // Bun single-node deployments carry the schema with them.
      const migrationsDir = value(source, "EDGESPEC_MIGRATIONS") ?? "migrations";
      try {
        await applySqliteMigrations(resolved.db, migrationsDir);
      } catch (error) {
        throw new Error(
          `Could not apply sqlite migrations from "${migrationsDir}" (set EDGESPEC_MIGRATIONS to override): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  // Objects: S3 API covers AWS, R2, MinIO and Supabase.
  const explicitBlob = value(source, "EDGESPEC_BLOB")?.toLowerCase();
  // `r2` is an alias for the same S3 adapter: R2 speaks the S3 API.
  const blobDriver = explicitBlob === "r2" ? "s3" : (explicitBlob ?? (provider ? "s3" : undefined));
  if (!env.BLOB && !env.ARTIFACTS && blobDriver === "s3") {
    const bucket = value(source, "EDGESPEC_BLOB_BUCKET");
    const accessKeyId = value(source, "EDGESPEC_BLOB_ACCESS_KEY_ID");
    const secretAccessKey = value(source, "EDGESPEC_BLOB_SECRET_ACCESS_KEY");
    if (bucket && accessKeyId && secretAccessKey) {
      const region = value(source, "EDGESPEC_BLOB_REGION") ?? "auto";
      env.BLOB = s3Store({
        endpoint: value(source, "EDGESPEC_BLOB_ENDPOINT") ?? `https://s3.${region}.amazonaws.com`,
        bucket,
        region,
        accessKeyId,
        secretAccessKey,
        ...(value(source, "EDGESPEC_BLOB_PREFIX")
          ? { prefix: value(source, "EDGESPEC_BLOB_PREFIX") as string }
          : {}),
      });
    } else if (explicitBlob) {
      throw new Error(
        `EDGESPEC_BLOB=${explicitBlob} requires EDGESPEC_BLOB_BUCKET, EDGESPEC_BLOB_ACCESS_KEY_ID and EDGESPEC_BLOB_SECRET_ACCESS_KEY.`,
      );
    }
  } else if (explicitBlob && explicitBlob !== "s3" && explicitBlob !== "r2") {
    throw new Error(`Unknown EDGESPEC_BLOB adapter "${explicitBlob}". Use s3 or r2.`);
  }

  // Jobs: Cloudflare Workflows is a binding; everything else speaks HTTP.
  const explicitJobs = value(source, "EDGESPEC_JOBS")?.toLowerCase();
  const jobsDriver = explicitJobs ?? (provider ? "http" : undefined);
  if (!env.JOBS && !env.TEST_GENERATION_WORKFLOW && jobsDriver === "http") {
    const url = value(source, "EDGESPEC_JOB_URL");
    if (url) {
      env.JOBS = httpJobs({
        url,
        ...(value(source, "EDGESPEC_JOB_KEY") ? { key: value(source, "EDGESPEC_JOB_KEY") } : {}),
      });
    } else if (explicitJobs) {
      throw new Error("EDGESPEC_JOBS=http requires EDGESPEC_JOB_URL.");
    }
  } else if (explicitJobs === "workflows" && !env.JOBS && !env.TEST_GENERATION_WORKFLOW) {
    throw new Error("EDGESPEC_JOBS=workflows requires the TEST_GENERATION_WORKFLOW binding.");
  } else if (explicitJobs && explicitJobs !== "http" && explicitJobs !== "workflows") {
    throw new Error(`Unknown EDGESPEC_JOBS adapter "${explicitJobs}". Use http or workflows.`);
  }

  // Cache: KV is a binding, Redis is Upstash REST, memory is one process.
  const explicitCache = value(source, "EDGESPEC_CACHE")?.toLowerCase();
  const cacheDriver =
    explicitCache ?? (provider === "node" ? "memory" : provider ? "redis" : undefined);
  if (!env.CACHE && cacheDriver === "redis") {
    const url = value(source, "EDGESPEC_REDIS_URL");
    if (url) {
      env.CACHE = redisCache({
        url,
        ...(value(source, "EDGESPEC_REDIS_TOKEN")
          ? { token: value(source, "EDGESPEC_REDIS_TOKEN") }
          : {}),
      });
      env.CACHE_DRIVER = "redis";
    } else if (explicitCache) {
      throw new Error("EDGESPEC_CACHE=redis requires EDGESPEC_REDIS_URL.");
    }
  } else if (!env.CACHE && cacheDriver === "memory") {
    env.CACHE = memoryCache();
    env.CACHE_DRIVER = "memory";
  } else if (!env.CACHE && explicitCache === "kv") {
    throw new Error("EDGESPEC_CACHE=kv requires the CACHE KV binding.");
  } else if (!env.CACHE && explicitCache && explicitCache !== "redis" && explicitCache !== "kv") {
    throw new Error(`Unknown EDGESPEC_CACHE adapter "${explicitCache}". Use kv, redis or memory.`);
  }

  if (env.CACHE && !env.CACHE_DRIVER) env.CACHE_DRIVER = "kv";
  return env;
}
