import { describe, expect, it } from "bun:test";
import { httpJobs } from "../src/adapters/http-jobs";
import { createPlatform } from "../src/adapters/select";
import { runGenerationJob } from "../src/jobs";
import { artifactsStore, capabilities, historyDb, jobsQueue } from "../src/platform";

describe("provider selection", () => {
  it("leaves every capability off when nothing is configured", async () => {
    const env = await createPlatform({}, {});
    expect(capabilities(env)).toEqual({
      history: false,
      artifacts: false,
      jobs: "none",
      durableJobs: false,
      cache: "none",
      cron: false,
      ai: "byok-only",
      assets: false,
    });
  });

  it("gives a node deployment a memory cache and nothing else it cannot back", async () => {
    const env = await createPlatform({}, { EDGESPEC_PROVIDER: "node" });
    expect(env.CACHE_DRIVER).toBe("memory");
    expect(env.CACHE).toBeDefined();
    expect(env.DB).toBeUndefined();
    expect(env.BLOB).toBeUndefined();
    expect(env.JOBS).toBeUndefined();
  });

  it("fails an explicit adapter whose env is missing", async () => {
    await expect(createPlatform({}, { EDGESPEC_DB: "postgres" })).rejects.toThrow(
      "EDGESPEC_DB_URL",
    );
    await expect(createPlatform({}, { EDGESPEC_DB: "d1" })).rejects.toThrow("RUNS_DB");
  });

  it("treats EDGESPEC_BLOB=r2 as the S3 adapter", async () => {
    const env = await createPlatform(
      {},
      {
        EDGESPEC_BLOB: "r2",
        EDGESPEC_BLOB_ENDPOINT: "https://account.r2.cloudflarestorage.com",
        EDGESPEC_BLOB_BUCKET: "edge-spec",
        EDGESPEC_BLOB_ACCESS_KEY_ID: "key",
        EDGESPEC_BLOB_SECRET_ACCESS_KEY: "secret",
      },
    );
    expect(env.BLOB).toBeDefined();
    expect(capabilities(env).artifacts).toBe(true);
  });

  it("rejects an unknown blob adapter", async () => {
    await expect(createPlatform({}, { EDGESPEC_BLOB: "gcs" })).rejects.toThrow("EDGESPEC_BLOB");
  });

  it("keeps a Cloudflare binding ahead of a provider default", async () => {
    const db = { prepare: () => ({}) as never, batch: async () => [] };
    const env = await createPlatform({ DB: db }, { EDGESPEC_PROVIDER: "node" });
    expect(env.DB).toBe(db);
  });

  it("reports the cache driver it actually picked", async () => {
    const env = await createPlatform({}, { EDGESPEC_CACHE: "memory" });
    expect(capabilities(env).cache).toBe("memory");
  });

  it("fills every Vercel default when its env is present", async () => {
    const env = await createPlatform(
      {},
      {
        EDGESPEC_PROVIDER: "vercel",
        EDGESPEC_DB_URL: "postgres://user:pass@localhost:5432/edge",
        EDGESPEC_BLOB_BUCKET: "edge-spec",
        EDGESPEC_BLOB_ACCESS_KEY_ID: "key",
        EDGESPEC_BLOB_SECRET_ACCESS_KEY: "secret",
        EDGESPEC_JOB_URL: "https://runner.example",
        EDGESPEC_REDIS_URL: "https://redis.example",
      },
    );
    expect(capabilities(env)).toMatchObject({
      history: true,
      artifacts: true,
      jobs: "external",
      cache: "redis",
    });
  });

  it("leaves a provider default off when its env is missing", async () => {
    const env = await createPlatform({}, { EDGESPEC_PROVIDER: "vercel" });
    expect(capabilities(env)).toEqual({
      history: false,
      artifacts: false,
      jobs: "none",
      durableJobs: false,
      cache: "none",
      cron: false,
      ai: "byok-only",
      assets: false,
    });
  });

  it("lets an explicit override win over the provider default", async () => {
    const env = await createPlatform({}, { EDGESPEC_PROVIDER: "vercel", EDGESPEC_CACHE: "memory" });
    expect(capabilities(env).cache).toBe("memory");
  });

  it("names the missing variable for every explicit adapter", async () => {
    await expect(createPlatform({}, { EDGESPEC_BLOB: "s3" })).rejects.toThrow(
      "EDGESPEC_BLOB_BUCKET",
    );
    await expect(createPlatform({}, { EDGESPEC_JOBS: "http" })).rejects.toThrow("EDGESPEC_JOB_URL");
    await expect(createPlatform({}, { EDGESPEC_CACHE: "redis" })).rejects.toThrow(
      "EDGESPEC_REDIS_URL",
    );
  });

  it("prefers the neutral binding over the legacy alias", async () => {
    const db = { prepare: () => ({}) as never, batch: async () => [] };
    const legacyDb = { prepare: () => ({}) as never, batch: async () => [] };
    const blob = {
      put: async () => undefined,
      get: async () => null,
      delete: async () => undefined,
    };
    const legacyBlob = {
      put: async () => undefined,
      get: async () => null,
      delete: async () => undefined,
    };
    const job = { id: "job", status: async () => ({ status: "queued" }) };
    const queue = { create: async () => job, get: async () => job };
    const legacyQueue = { create: async () => job, get: async () => job };

    const env = await createPlatform(
      {
        DB: db,
        RUNS_DB: legacyDb,
        BLOB: blob,
        ARTIFACTS: legacyBlob,
        JOBS: queue,
        TEST_GENERATION_WORKFLOW: legacyQueue,
      },
      {},
    );

    expect(historyDb(env)).toBe(db);
    expect(artifactsStore(env)).toBe(blob);
    expect(jobsQueue(env)).toBe(queue);
    expect(capabilities(env)).toMatchObject({ history: true, artifacts: true, jobs: "external" });
  });
});

describe("http jobs", () => {
  it("creates and polls through the runner contract", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (init?.method === "POST") return Response.json({ id: "job-1" });
      return Response.json({ status: "complete", output: { ok: true } });
    }) as typeof fetch;
    try {
      const queue = httpJobs({ url: "https://runner.example", key: "secret" });
      const job = await queue.create({ params: { repo: "acme/api" } });
      expect(job.id).toBe("job-1");
      expect(await job.status()).toMatchObject({ status: "complete" });
      expect(calls).toEqual([
        "POST https://runner.example/jobs",
        "GET https://runner.example/jobs/job-1",
      ]);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("jobs", () => {
  it("is orchestration only, with no runtime import", () => {
    expect(typeof runGenerationJob).toBe("function");
  });
});
