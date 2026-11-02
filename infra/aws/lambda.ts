/**
 * AWS Lambda entry (Function URL). Same Hono app; the event envelope is the
 * adapter's job (`@edge-spec/adapters/aws/lambda`). The platform is built once
 * per cold start from `process.env`, so a bad env fails that invocation instead
 * of crashing the module load — matching the Vercel handler.
 */
import { app } from "@edge-spec/runtime/app";
import { platformFromEnv } from "@edge-spec/adapters/node";
import {
  lambdaHandler,
  type LambdaUrlEvent,
  type LambdaUrlResult,
} from "@edge-spec/adapters/aws/lambda";

let platform: ReturnType<typeof platformFromEnv> | undefined;

export async function handler(event: LambdaUrlEvent): Promise<LambdaUrlResult> {
  platform ??= platformFromEnv(process.env);
  const env = await platform;
  return lambdaHandler(event, (request) => Promise.resolve(app.fetch(request, env)));
}
