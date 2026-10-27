/**
 * Route-level tests for the Worker's HTTP surface. They never call GitHub, AI
 * or a runner: every case either validates input, checks a missing binding, or
 * reads from a fake D1/R2.
 */
import { afterAll, describe, expect, it, mock } from "bun:test";
import type { D1Database, D1PreparedStatement, Env, R2Bucket } from "../src/env";

mock.module("cloudflare:workers", () => ({ WorkflowEntrypoint: class {} }));
const { default: worker } = await import("../src/index");

const ID = "01234567-89ab-cdef-0123-456789abcdef";
const fetchApp = (path: string, init?: RequestInit, env: Env = baseEnv()) => {
  const url = path.startsWith("http") ? path : `https://edge.example${path}`;
  return (worker.fetch as (request: Request, env: Env) => Promise<Response>)(
    new Request(url, init),
    env,
  );
};

function baseEnv(): Env {
  return {
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
  };
}

function fakeDb(ids: string[] = []): D1Database {
  const statement = {
    bind: () => statement,
    first: async () => null,
    all: async () => ({ results: ids.map((id) => ({ id })) }),
    run: async () => ({}),
  } as unknown as D1PreparedStatement;
  return { prepare: () => statement, batch: async () => [] };
}

function fakeBucket(): R2Bucket {
  const objects = new Map<string, string>();
  return {
    async put(key, value) {
      objects.set(key, value);
    },
    async get(key) {
      const value = objects.get(key);
      return value === undefined ? null : { text: async () => value };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

afterAll(() => mock.restore());

describe("public routes", () => {
  it("reports health and the provider catalog", async () => {
    const health = await fetchApp("/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok", app: "EdgeSpec" });

    const catalog = await fetchApp("/api/catalog");
    const body = (await catalog.json()) as { providers: unknown[]; sandbox: boolean };
    expect(body.providers.length).toBeGreaterThan(3);
    expect(body.sandbox).toBe(false);

    const withRunner = await fetchApp("/api/catalog", undefined, {
      ...baseEnv(),
      SANDBOX_RUNNER_URL: "https://runner.example",
    });
    expect(((await withRunner.json()) as { sandbox: boolean }).sandbox).toBe(true);
  });

  it("returns JSON 404 for unknown API paths and serves assets otherwise", async () => {
    const missing = await fetchApp("/api/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Not found" });

    const asset = await fetchApp("/dashboard");
    expect(await asset.text()).toBe("asset");
  });

  it("keeps local-only routes closed to remote hosts", async () => {
    for (const path of ["/local-api/scan", "/local-api/file"]) {
      const remote = await fetchApp(path);
      expect(remote.status).toBe(403);
      const local = await fetchApp(`http://localhost${path}`, { headers: { host: "localhost" } });
      expect(local.status).toBe(400);
      expect(((await local.json()) as { error: string }).error).toContain("bun run dev");
    }
  });
});

describe("input validation", () => {
  it("rejects malformed JSON and a missing repository", async () => {
    for (const path of ["/api/scan", "/api/impact", "/api/run", "/api/generate"]) {
      const bad = await fetchApp(path, { method: "POST", body: "{" });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: string }).error).toBe("Invalid JSON body.");
    }

    for (const path of ["/api/scan", "/api/impact", "/api/run", "/api/pull-request"]) {
      const empty = await fetchApp(path, { method: "POST", body: "{}" });
      expect(empty.status).toBe(400);
      expect(((await empty.json()) as { error: string }).error).toContain("owner/name");
    }
  });

  it("requires a changed path for impact and files for a pull request", async () => {
    const impact = await fetchApp("/api/impact", {
      method: "POST",
      body: JSON.stringify({ repo: "acme/api" }),
    });
    expect(impact.status).toBe(400);
    expect(((await impact.json()) as { error: string }).error).toContain("changed path");

    const pull = await fetchApp("/api/pull-request", {
      method: "POST",
      body: JSON.stringify({ repo: "acme/api" }),
    });
    expect(pull.status).toBe(400);
    expect(((await pull.json()) as { error: string }).error).toContain("test file");
  });

  it("only accepts inline source on localhost", async () => {
    const remote = await fetchApp("/api/generate", {
      method: "POST",
      body: JSON.stringify({ path: "src/a.ts", source: "export const a = 1;" }),
    });
    expect(remote.status).toBe(403);

    const local = await fetchApp("http://localhost/api/generate", {
      method: "POST",
      headers: { host: "localhost", "x-sandbox-url": "http://runner.example" },
      body: JSON.stringify({ path: "src/a.ts", source: "export const a = 1;" }),
    });
    expect(local.status).toBe(400);
    expect(((await local.json()) as { error: string }).error).toContain("sandbox URL");
  });
});

describe("optional bindings", () => {
  it("answers enabled:false when history and artifacts are unbound", async () => {
    for (const path of [
      "/api/runs?repo=acme/api",
      "/api/backlog?repo=acme/api",
      "/api/schedules",
      "/api/workspace",
      "/api/audit",
      "/api/memory?repo=acme/api",
      "/api/policies?repo=acme/api",
    ]) {
      const response = await fetchApp(path);
      expect(response.status).toBe(200);
      expect(((await response.json()) as { enabled: boolean }).enabled).toBe(false);
    }

    const artifacts = await fetchApp(`/api/runs/${ID}/artifacts`);
    expect(await artifacts.json()).toEqual({ enabled: false });
  });

  it("answers 501 for writes that need D1", async () => {
    for (const [path, method] of [
      ["/api/backlog?repo=acme/api", "PATCH"],
      ["/api/schedules?repo=acme/api", "PUT"],
      ["/api/schedules?repo=acme/api", "DELETE"],
      ["/api/workspace", "PUT"],
      ["/api/memory?repo=acme/api", "PUT"],
      ["/api/memory?repo=acme/api", "DELETE"],
      ["/api/policies?repo=acme/api", "PUT"],
      ["/api/policies?repo=acme/api", "DELETE"],
      [`/api/runs/${ID}/decisions`, "POST"],
    ] as const) {
      const response = await fetchApp(path, { method, body: "{}" });
      expect(response.status).toBe(501);
    }
  });
});

describe("run history and artifacts", () => {
  it("validates repository and run ids before querying", async () => {
    const env = { ...baseEnv(), RUNS_DB: fakeDb(), ARTIFACTS: fakeBucket() };

    for (const path of [
      "/api/runs?repo=nope",
      "/api/memory?repo=nope",
      "/api/policies?repo=nope",
    ]) {
      const response = await fetchApp(path, undefined, env);
      expect(response.status).toBe(400);
    }

    for (const path of [
      `/api/runs/short/files`,
      `/api/runs/short/artifacts`,
      `/api/runs/short/decisions`,
      `/api/runs/bad@id`,
    ]) {
      const response = await fetchApp(
        path,
        { method: path.endsWith("decisions") ? "POST" : "GET" },
        env,
      );
      expect(response.status).toBe(400);
    }
  });

  it("returns an empty history, a missing run, and a missing bundle honestly", async () => {
    const env = { ...baseEnv(), RUNS_DB: fakeDb(), ARTIFACTS: fakeBucket() };
    const runs = await fetchApp("/api/runs?repo=acme/api", undefined, env);
    expect(await runs.json()).toEqual({ enabled: true, runs: [] });

    const files = await fetchApp(`/api/runs/${ID}/files`, undefined, env);
    expect(files.status).toBe(404);

    const artifacts = await fetchApp(`/api/runs/${ID}/artifacts`, undefined, env);
    expect(artifacts.status).toBe(404);
  });

  it("round-trips a stored bundle and requires decisions", async () => {
    const env = { ...baseEnv(), RUNS_DB: fakeDb(), ARTIFACTS: fakeBucket() };
    await env.ARTIFACTS?.put(`runs/${ID}.json`, JSON.stringify({ runId: ID, status: "ready" }));

    const artifacts = await fetchApp(`/api/runs/${ID}/artifacts`, undefined, env);
    expect(artifacts.status).toBe(200);
    expect(await artifacts.json()).toEqual({
      enabled: true,
      artifact: { runId: ID, status: "ready" },
    });

    const empty = await fetchApp(`/api/runs/${ID}/decisions`, { method: "POST", body: "{}" }, env);
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toContain("decision");
  });

  it("reports a missing workflow binding for real workflow ids", async () => {
    const response = await fetchApp("/api/runs/workflow-123");
    expect(response.status).toBe(501);
  });

  it("deletes a repository's history and its R2 bundle", async () => {
    const env = { ...baseEnv(), RUNS_DB: fakeDb([ID]), ARTIFACTS: fakeBucket() };
    await env.ARTIFACTS?.put(`runs/${ID}.json`, "{}");
    const response = await fetchApp("/api/runs?repo=acme/api", { method: "DELETE" }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 1 });
    expect(await env.ARTIFACTS?.get(`runs/${ID}.json`)).toBeNull();
  });
});

describe("webhooks", () => {
  const post = (body: string, headers: Record<string, string> = {}, env: Env = baseEnv()) =>
    fetchApp("/webhook", { method: "POST", body, headers }, env);

  it("rejects a bad signature before parsing the payload", async () => {
    const env = { ...baseEnv(), GITHUB_WEBHOOK_SECRET: "secret" };
    const response = await post("{}", { "x-hub-signature-256": "sha256=bad" }, env);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toContain("signature");
  });

  it("validates the payload, then the workflow binding", async () => {
    expect((await post("{")).status).toBe(400);
    expect((await post("{}")).status).toBe(400);

    const valid = JSON.stringify({ repository: { full_name: "acme/api" }, ref: "refs/heads/main" });
    const response = await post(valid);
    expect(response.status).toBe(501);
    expect(((await response.json()) as { error: string }).error).toContain("Workflows");
  });

  it("ignores unrelated events without starting a workflow", async () => {
    const env = {
      ...baseEnv(),
      TEST_GENERATION_WORKFLOW: {
        create: async () => {
          throw new Error("An ignored event must not start a workflow.");
        },
        get: async () => {
          throw new Error("An ignored event must not read a workflow.");
        },
      },
    } as Env;
    const base = { repository: { full_name: "acme/api" } };
    const cases: Array<[Record<string, string>, Record<string, unknown>, string]> = [
      [{ "x-github-event": "pull_request" }, { ...base, action: "closed" }, "closed"],
      [{ "x-github-event": "issue_comment" }, { ...base, action: "edited" }, "edited"],
      [
        { "x-github-event": "issue_comment" },
        { ...base, action: "created", issue: { number: 1 }, comment: { body: "/edgespec retest" } },
        "not a pull request",
      ],
      [
        { "x-github-event": "issue_comment" },
        {
          ...base,
          action: "created",
          issue: { number: 1, pull_request: {} },
          comment: { body: "/edgespec retest", user: { login: "stranger", type: "User" } },
        },
        "unauthorized",
      ],
    ];

    for (const [headers, payload, ignored] of cases) {
      const response = await post(JSON.stringify(payload), headers, env);
      expect(response.status).toBe(202);
      expect(((await response.json()) as { ignored: string }).ignored).toBe(ignored);
    }
  });
});
