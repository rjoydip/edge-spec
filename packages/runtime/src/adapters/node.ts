/**
 * `process.env` -> `Env`. Node/Bun only; the Cloudflare entry never imports it.
 */
import type { Env } from "../env";
import { createPlatform } from "./select";

export function platformFromEnv(
  source: Record<string, string | undefined> = process.env,
): Promise<Env> {
  return createPlatform({}, source);
}
