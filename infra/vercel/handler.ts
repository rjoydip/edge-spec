/**
 * Vercel function handler. Vercel only discovers functions under the root
 * `api/` directory, so `api/index.ts` re-exports this file; everything
 * provider-specific stays here. The platform is built once per instance from
 * `process.env` on the first request, so a bad env fails that request instead
 * of crashing the module load.
 */
import { app } from "@edge-spec/runtime/app";
import { platformFromEnv } from "@edge-spec/adapters/node";

let platform: ReturnType<typeof platformFromEnv> | undefined;

async function handler(request: Request): Promise<Response> {
  platform ??= platformFromEnv(process.env);
  return app.fetch(request, await platform);
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as OPTIONS,
};
