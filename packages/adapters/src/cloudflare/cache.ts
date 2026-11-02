import type { CacheStore } from "@edge-spec/runtime/env";

/** The slice of the Cloudflare KV binding used here. */
export interface KvBinding {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** KV requires an expiration of at least 60 seconds. */
export function kvCache(kv: KvBinding): CacheStore {
  return {
    async get<T>(key: string) {
      const value = await kv.get(key, "json");
      return value === null || value === undefined ? undefined : (value as T);
    },
    async set<T>(key: string, value: T, ttlSeconds: number) {
      await kv.put(key, JSON.stringify(value), {
        expirationTtl: Math.max(60, Math.round(ttlSeconds)),
      });
    },
    async delete(key: string) {
      await kv.delete(key);
    },
  };
}
