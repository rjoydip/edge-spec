import { describe, expect, it } from "bun:test";
import {
  EdgeSpecClient,
  clientConfigFromEnv,
  collectGenerations,
  envDefaults,
  finalResult,
  type RunEvent,
} from "../src";

const generation = {
  sourcePath: "src/a.ts",
  testPath: "src/a.test.ts",
  code: "import { a } from './a';",
  provider: "openai",
  model: "test-model",
  corrected: false,
};

const validation = {
  ok: true,
  verified: false,
  output: "static check only",
  durationMs: 12,
};

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("EdgeSpecClient", () => {
  it("sends credentials in headers and the generate body", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      Response.json({ generation, validation, attempts: 1 }),
    );
    const client = new EdgeSpecClient({
      baseUrl: "https://edge.test/",
      githubToken: "gh-token",
      aiKey: "ai-key",
      aiBaseUrl: "https://ai.test",
      sandboxUrl: "https://runner.test",
      sandboxKey: "runner-key",
      deploymentAi: true,
      fetchImpl,
    });

    const result = await client.generate({
      repo: "owner/repo",
      path: "src/a.ts",
      provider: "openai",
      model: "test-model",
      strictTypes: false,
      maxRetries: 2,
    });

    expect(result.generation.code).toContain("import");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://edge.test/api/generate");
    const headers = calls[0]!.init.headers as Record<string, string>;

    expect(headers["x-github-token"]).toBe("gh-token");
    expect(headers["x-ai-key"]).toBe("ai-key");
    expect(headers["x-ai-base-url"]).toBe("https://ai.test");
    expect(headers["x-sandbox-url"]).toBe("https://runner.test");
    expect(headers["x-sandbox-key"]).toBe("runner-key");
    expect(headers["x-deployment-ai"]).toBe("1");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      repo: "owner/repo",
      ref: "main",
      path: "src/a.ts",
      provider: "openai",
      model: "test-model",
      strictTypes: false,
      maxRetries: 2,
    });
  });

  it("sends inline source for watch mode without a repository", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      Response.json({ generation, validation, attempts: 1 }),
    );
    const client = new EdgeSpecClient({ baseUrl: "https://edge.test", fetchImpl });

    await client.generate({ source: "export const a = 1;", path: "src/a.ts" });

    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body.source).toBe("export const a = 1;");
    expect(body.path).toBe("src/a.ts");
    expect(body.repo).toBeUndefined();
  });

  it("surfaces API error messages", async () => {
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(JSON.stringify({ error: "repository not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = new EdgeSpecClient({ baseUrl: "https://edge.test", fetchImpl });
    await expect(client.scan({ repo: "owner/missing" })).rejects.toThrow("repository not found");
  });

  it("parses split SSE frames and ignores the done frame", async () => {
    const encoder = new TextEncoder();
    const frames = [
      'event: log\ndata: {"type":"log","level":"info","text":"scanning"}\n\n',
      'event: generation\ndata: {"type":"generation","generation":' +
        JSON.stringify(generation) +
        "}\n\n",
      "event: done\ndata: {}\n\n",
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) {
          const half = Math.floor(frame.length / 2);
          controller.enqueue(encoder.encode(frame.slice(0, half)));
          controller.enqueue(encoder.encode(frame.slice(half)));
        }
        controller.close();
      },
    });
    const { fetchImpl } = fakeFetch(() => new Response(stream, { status: 200 }));
    const client = new EdgeSpecClient({ baseUrl: "https://edge.test", fetchImpl });
    const seen: RunEvent[] = [];
    const events = await client.run({ repo: "owner/repo" }, (event) => seen.push(event));

    expect(events.map((event) => event.type)).toEqual(["log", "generation"]);
    expect(seen).toHaveLength(2);
  });

  it("pairs validations with generations and finds the final result", () => {
    const events: RunEvent[] = [
      { type: "generation", generation },
      { type: "validation", validation, sourcePath: "src/a.ts" },
      { type: "result", ok: true, ready: ["src/a.ts"] },
    ];
    const generated = collectGenerations(events);
    expect(generated.get("src/a.ts")?.validation?.ok).toBe(true);
    expect(finalResult(events)?.ready).toEqual(["src/a.ts"]);
  });
});

describe("environment config", () => {
  it("maps provider-specific keys and normalizes the URL", () => {
    const env = {
      EDGESPEC_URL: "https://edge.example/",
      GITHUB_TOKEN: "gh",
      EDGESPEC_AI_PROVIDER: "openai",
      EDGESPEC_AI_MODEL: "gpt-test",
      OPENAI_API_KEY: "sk-test",
      EDGESPEC_DEPLOYMENT_AI: "true",
    };
    const defaults = envDefaults(env, "openai");
    expect(defaults.baseUrl).toBe("https://edge.example");
    expect(defaults.githubToken).toBe("gh");
    expect(defaults.aiKey).toBe("sk-test");
    expect(defaults.provider).toBe("openai");
    expect(defaults.model).toBe("gpt-test");
    expect(defaults.deploymentAi).toBe(true);
    expect(clientConfigFromEnv(env, "openai").aiKey).toBe("sk-test");
  });

  it("lets EDGESPEC_AI_KEY override the provider key", () => {
    const defaults = envDefaults(
      { EDGESPEC_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "a", EDGESPEC_AI_KEY: "b" },
      "anthropic",
    );
    expect(defaults.aiKey).toBe("b");
  });
});
