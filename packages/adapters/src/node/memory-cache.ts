/**
 * In-process cache with a TTL. One process only, cleared on restart: use it for
 * local development and single-node self-hosting, never for a fleet.
 */
import type { CacheStore } from "@edge-spec/runtime/env";

export function memoryCache(now: () => number = Date.now): CacheStore {
  const entries = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return hit.value as T;
    },
    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      entries.set(key, { value, expiresAt: now() + Math.max(1, ttlSeconds) * 1000 });
    },
    async delete(key: string): Promise<void> {
      entries.delete(key);
    },
  };
}
