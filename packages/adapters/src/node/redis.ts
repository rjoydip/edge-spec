/**
 * Cache over the Upstash Redis REST API. Zero dependencies, works on Workers,
 * Vercel and AWS. Vercel KV is Upstash, so it uses the same variables.
 */
import type { CacheStore } from "@edge-spec/runtime/env";

export interface RedisCacheOptions {
  url: string;
  token?: string;
}

export function redisCache(options: RedisCacheOptions): CacheStore {
  const headers = {
    "content-type": "application/json",
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
  };

  const send = async (command: unknown[]): Promise<unknown> => {
    const response = await fetch(options.url, {
      method: "POST",
      headers,
      body: JSON.stringify(command),
    });
    if (!response.ok) throw new Error(`Redis returned ${response.status}.`);
    const body = (await response.json()) as { result?: unknown; error?: string };
    if (body.error) throw new Error(body.error);
    return body.result;
  };

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const raw = await send(["GET", key]);
      if (typeof raw !== "string") return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return undefined;
      }
    },
    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      await send(["SET", key, JSON.stringify(value), "EX", Math.max(1, Math.round(ttlSeconds))]);
    },
    async delete(key: string): Promise<void> {
      await send(["DEL", key]);
    },
  };
}
