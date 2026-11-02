/**
 * Cache behaviour without HTTP: the read-through wrapper, the in-memory
 * adapter, and the two remote adapters' wire formats.
 */
import { describe, expect, it } from "bun:test";
import { cached } from "@edge-spec/runtime/app";
import { memoryCache } from "../src/node/memory-cache";
import { redisCache } from "../src/node/redis";
import type { CacheStore, Env } from "@edge-spec/runtime/env";
import { kvCache, type KvBinding } from "../src/cloudflare/cache";

const context = (env: Env): Parameters<typeof cached>[0] =>
  ({ env }) as unknown as Parameters<typeof cached>[0];

function recordingCache(): { cache: CacheStore; sets: { key: string; ttl: number }[] } {
  const entries = new Map<string, unknown>();
  const sets: { key: string; ttl: number }[] = [];
  return {
    sets,
    cache: {
      async get<T>(key: string) {
        return entries.get(key) as T | undefined;
      },
      async set<T>(key: string, value: T, ttlSeconds: number) {
        sets.push({ key, ttl: ttlSeconds });
        entries.set(key, value);
      },
      async delete(key: string) {
        entries.delete(key);
      },
    },
  };
}

describe("read-through cache", () => {
  it("misses, loads, then stores with the TTL; a hit skips the load", async () => {
    const { cache, sets } = recordingCache();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return { value: 1 };
    };

    const first = await cached(context({ CACHE: cache }), "k", 60, load);
    const second = await cached(context({ CACHE: cache }), "k", 60, load);

    expect(first).toEqual({ value: 1 });
    expect(second).toEqual(first);
    expect(loads).toBe(1);
    expect(sets).toEqual([{ key: "k", ttl: 60 }]);
  });

  it("still loads when the deployment has no cache", async () => {
    let loads = 0;
    await cached(context({}), "k", 60, async () => {
      loads += 1;
      return 1;
    });
    expect(loads).toBe(1);
  });

  it("treats a cache read or write failure as a miss", async () => {
    const broken: CacheStore = {
      async get() {
        throw new Error("cache down");
      },
      async set() {
        throw new Error("cache down");
      },
      async delete() {
        throw new Error("cache down");
      },
    };
    let loads = 0;

    const value = await cached(context({ CACHE: broken }), "k", 60, async () => {
      loads += 1;
      return "fresh";
    });

    expect(value).toBe("fresh");
    expect(loads).toBe(1);
  });
});

describe("memory cache", () => {
  it("expires after the TTL", async () => {
    let now = 0;
    const cache = memoryCache(() => now);
    await cache.set("k", { value: 1 }, 60);
    expect(await cache.get("k")).toEqual({ value: 1 });
    now = 59_000;
    expect(await cache.get("k")).toEqual({ value: 1 });
    now = 60_001;
    expect(await cache.get("k")).toBeUndefined();
  });

  it("deletes on demand", async () => {
    const cache = memoryCache();
    await cache.set("k", "v", 60);
    await cache.delete("k");
    expect(await cache.get("k")).toBeUndefined();
  });
});

describe("redis cache", () => {
  it("sends Upstash REST commands and round-trips JSON", async () => {
    const commands: unknown[][] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as unknown[];
      commands.push(command);
      if (command[0] === "GET") return Response.json({ result: JSON.stringify({ hit: 1 }) });
      return Response.json({ result: "OK" });
    }) as typeof fetch;
    try {
      const cache = redisCache({ url: "https://redis.example", token: "token" });
      expect(await cache.get("k")).toEqual({ hit: 1 });
      await cache.set("k", { hit: 1 }, 60);
      await cache.delete("k");
      expect(commands).toEqual([
        ["GET", "k"],
        ["SET", "k", JSON.stringify({ hit: 1 }), "EX", 60],
        ["DEL", "k"],
      ]);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("kv cache", () => {
  function fakeKv(): { kv: KvBinding; puts: (number | undefined)[] } {
    const entries = new Map<string, unknown>();
    const puts: (number | undefined)[] = [];
    return {
      puts,
      kv: {
        async get(key: string) {
          return entries.get(key) ?? null;
        },
        async put(key: string, value: string, options?: { expirationTtl?: number }) {
          puts.push(options?.expirationTtl);
          entries.set(key, JSON.parse(value));
        },
        async delete(key: string) {
          entries.delete(key);
        },
      },
    };
  }

  it("round-trips JSON and keeps KV's 60 second floor", async () => {
    const { kv, puts } = fakeKv();
    const cache = kvCache(kv);

    await cache.set("short", { hit: 1 }, 5);
    expect(await cache.get("short")).toEqual({ hit: 1 });
    await cache.set("long", { hit: 2 }, 120);

    expect(puts).toEqual([60, 120]);
  });

  it("maps a missing key to undefined and deletes", async () => {
    const { kv } = fakeKv();
    const cache = kvCache(kv);

    expect(await cache.get("missing")).toBeUndefined();
    await cache.set("k", "v", 60);
    await cache.delete("k");
    expect(await cache.get("k")).toBeUndefined();
  });
});
