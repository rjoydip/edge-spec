/**
 * Cloudflare Worker entry. The Hono app is shared; this file is the only place
 * that knows about Workflows, the scheduled handler and the raw KV binding.
 * The adapters themselves live in `@edge-spec/adapters/cloudflare`.
 */
import type { ExecutionContext } from "hono";
import type { Env } from "@edge-spec/runtime/env";
import { app } from "@edge-spec/runtime/app";
import {
  runScheduled,
  type ScheduledContext,
  type ScheduledController,
} from "@edge-spec/runtime/scheduled";
import { kvCache, type KvBinding } from "@edge-spec/adapters/cloudflare/cache";

export { TestGenerationWorkflow } from "@edge-spec/adapters/cloudflare/workflow";

/** Bindings as Cloudflare hands them over: `CACHE` is raw KV, not a CacheStore. */
type CloudflareEnv = Omit<Env, "CACHE"> & { CACHE?: KvBinding };

function platform(env: CloudflareEnv): Env {
  if (!env.CACHE) return env as Env;
  return { ...env, CACHE: kvCache(env.CACHE), CACHE_DRIVER: "kv" };
}

export default {
  fetch: (request: Request, env: CloudflareEnv, ctx: ExecutionContext) =>
    app.fetch(request, platform(env), ctx),
  scheduled: (controller: ScheduledController, env: CloudflareEnv, ctx: ScheduledContext) =>
    runScheduled(controller, platform(env), ctx),
};
