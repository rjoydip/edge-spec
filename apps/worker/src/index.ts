/**
 * Cloudflare Worker entry. The Hono app is shared; this file is the only place
 * that knows about Workflows, the scheduled handler and the raw KV binding.
 */
import type { ExecutionContext } from "hono";
import type { Env } from "@edge-spec/runtime/env";
import { app } from "@edge-spec/runtime/app";
import {
  runScheduled,
  type ScheduledContext,
  type ScheduledController,
} from "@edge-spec/runtime/scheduled";
import { kvCache, type KvBinding } from "./kv";

export { TestGenerationWorkflow } from "./workflow";

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
