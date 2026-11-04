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
import { r2Store, type R2Binding } from "@edge-spec/adapters/cloudflare/r2";

export { TestGenerationWorkflow } from "@edge-spec/adapters/cloudflare/workflow";

/** Bindings as Cloudflare hands them over: KV and R2 are raw, not ports. */
type CloudflareEnv = Omit<Env, "CACHE" | "ARTIFACTS"> & {
  CACHE?: KvBinding;
  ARTIFACTS?: R2Binding;
};

function platform(env: CloudflareEnv): Env {
  const { CACHE, ARTIFACTS, ...rest } = env;
  return {
    ...rest,
    ...(CACHE ? { CACHE: kvCache(CACHE), CACHE_DRIVER: "kv" as const } : {}),
    ...(ARTIFACTS ? { ARTIFACTS: r2Store(ARTIFACTS) } : {}),
  };
}

export default {
  fetch: (request: Request, env: CloudflareEnv, ctx: ExecutionContext) =>
    app.fetch(request, platform(env), ctx),
  scheduled: (controller: ScheduledController, env: CloudflareEnv, ctx: ScheduledContext) =>
    runScheduled(controller, platform(env), ctx),
};
