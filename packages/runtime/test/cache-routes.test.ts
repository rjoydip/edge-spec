/**
 * Acceptance criterion #9, at the route level: quota and branch lookups are
 * cached, a cache failure is a miss, and no cache key ever contains a raw token.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { app } from "../src/app";
import type { CacheStore, Env } from "../src/env";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeCache(): { cache: CacheStore; keys: string[] } {
  const entries = new Map<string, unknown>();
  const keys: string[] = [];
  return {
    keys,
    cache: {
      async get<T>(key: string): Promise<T | undefined> {
        keys.push(key);
        return entries.get(key) as T | undefined;
      },
      async set<T>(key: string, value: T): Promise<void> {
        keys.push(key);
        entries.set(key, value);
      },
      async delete(key: string): Promise<void> {
        entries.delete(key);
      },
    },
  };
}

/** Stubs `fetch` and records every URL it was asked for. */
function stubFetch(route: (url: string) => Response): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    return route(url);
  }) as typeof fetch;
  return calls;
}

const get = async (
  path: string,
  env: Env,
  headers: Record<string, string> = {},
): Promise<Response> => app.fetch(new Request(`https://edge.example${path}`, { headers }), env);

const TOKEN = "ghp_secret_token_value";
const AI_KEY = "sk-secret-ai-key";

describe("scan cache", () => {
  it("reuses GitHub tree and file reads when the TTL is set", async () => {
    const { cache, keys } = fakeCache();
    const treeUrl = "https://api.github.com/repos/acme/api/git/trees/main?recursive=1";
    const fileUrl = "https://api.github.com/repos/acme/api/contents/src/a.ts?ref=main";
    const calls = stubFetch((url) => {
      if (url === treeUrl) {
        return new Response(JSON.stringify({ tree: [{ path: "src/a.ts", type: "blob" }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url === fileUrl) {
        return new Response(
          JSON.stringify({ content: Buffer.from("export const a = 1;").toString("base64") }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });
    const env = { CACHE: cache, EDGESPEC_SCAN_CACHE_TTL: "60" } as Env;
    const scan = () =>
      app.fetch(
        new Request("https://edge.example/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo: "acme/api", ref: "main" }),
        }),
        env,
      );

    expect((await scan()).status).toBe(200);
    expect((await scan()).status).toBe(200);
    expect(calls.filter((url) => url === treeUrl)).toHaveLength(1);
    expect(calls.filter((url) => url === fileUrl)).toHaveLength(1);
    expect(keys.some((key) => key.startsWith("scan:"))).toBe(true);
    expect(keys.every((key) => !key.includes(TOKEN))).toBe(true);
  });
});

describe("cached routes", () => {
  it("serves quota from the cache and keeps the token out of the key", async () => {
    const { cache, keys } = fakeCache();
    const calls = stubFetch(
      () => new Response("{}", { headers: { "x-ratelimit-limit-requests": "100" } }),
    );
    const env = { CACHE: cache } as Env;
    const headers = { "x-ai-key": AI_KEY };

    const first = await (await get("/api/quota?provider=openai", env, headers)).json();
    const second = await (await get("/api/quota?provider=openai", env, headers)).json();

    expect(first).toEqual({ rateLimit: { provider: "openai", limit: 100 } });
    expect(second).toEqual(first);
    expect(calls.length).toBe(1);
    expect(keys.some((key) => /^quota:openai::[0-9a-f]{16}$/.test(key))).toBe(true);
    expect(keys.every((key) => !key.includes(AI_KEY))).toBe(true);
  });

  it("keys a different token separately", async () => {
    const { cache } = fakeCache();
    const calls = stubFetch(
      () => new Response("{}", { headers: { "x-ratelimit-limit-requests": "100" } }),
    );
    const env = { CACHE: cache } as Env;

    await get("/api/quota?provider=openai", env, { "x-ai-key": AI_KEY });
    await get("/api/quota?provider=openai", env, { "x-ai-key": `${AI_KEY}-other` });

    expect(calls.length).toBe(2);
  });

  it("caches branch lookups by repository and token fingerprint", async () => {
    const { cache, keys } = fakeCache();
    const calls = stubFetch((url) =>
      url.endsWith("/branches?per_page=100")
        ? Response.json([{ name: "dev" }, { name: "main" }])
        : Response.json({ default_branch: "main" }),
    );
    const env = { CACHE: cache } as Env;
    const headers = { "x-github-token": TOKEN };

    const first = await (await get("/api/branches?repo=acme/api", env, headers)).json();
    const second = await (await get("/api/branches?repo=acme/api", env, headers)).json();

    expect(first).toEqual({ branches: ["main", "dev"], defaultBranch: "main" });
    expect(second).toEqual(first);
    expect(calls.length).toBe(2);
    expect(keys.some((key) => /^branches:acme\/api:[0-9a-f]{16}$/.test(key))).toBe(true);
    expect(keys.every((key) => !key.includes(TOKEN))).toBe(true);
  });

  it("does not cache when the deployment has no cache", async () => {
    const calls = stubFetch(
      () => new Response("{}", { headers: { "x-ratelimit-limit-requests": "100" } }),
    );

    await get("/api/quota?provider=openai", {}, { "x-ai-key": AI_KEY });
    await get("/api/quota?provider=openai", {}, { "x-ai-key": AI_KEY });

    expect(calls.length).toBe(2);
  });

  it("treats a cache outage as a miss", async () => {
    const calls = stubFetch(
      () => new Response("{}", { headers: { "x-ratelimit-limit-requests": "100" } }),
    );
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

    const response = await get("/api/quota?provider=openai", { CACHE: broken } as Env, {
      "x-ai-key": AI_KEY,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rateLimit: { provider: "openai", limit: 100 } });
    expect(calls.length).toBe(1);
  });
});
