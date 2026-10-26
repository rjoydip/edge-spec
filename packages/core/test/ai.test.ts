import { describe, expect, it } from "bun:test";
import {
  buildPrompt,
  estimatePromptTokens,
  extractCode,
  generateTest,
  isPlausibleTest,
  probeRateLimit,
  type GenerateInput,
  type TokenUsage,
} from "../src/ai";
import { providerById } from "../src/catalog";
import type { RateLimitInfo } from "../src/types";

const TEST_CODE = `import { describe, it, expect } from "bun:test";
import { add } from "./math";

describe("add", () => {
  it("adds two numbers", () => {
    expect(add(1, 2)).toBe(3);
  });
});`;

const config = (id: string) => {
  const provider = providerById(id);
  if (!provider) throw new Error(`missing provider ${id}`);
  return provider;
};

function openAiReply(code: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: "```ts\n" + code + "\n```" } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function input(overrides: Partial<GenerateInput> & { provider: string }): GenerateInput {
  const provider = config(overrides.provider);
  const { provider: _provider, ...rest } = overrides;
  return {
    filePath: "src/math.ts",
    source: "export const add = (a: number, b: number) => a + b;",
    config: { provider, model: provider.models[0]?.id ?? "custom-model", apiKey: "sk-secret" },
    ...rest,
  };
}

describe("extractCode", () => {
  it("unwraps a fence and tolerates a bare reply", () => {
    expect(extractCode("```typescript\nA\n```")).toBe("A");
    expect(extractCode("B")).toBe("B");
  });
});

describe("isPlausibleTest", () => {
  it("requires a test block and an assertion", () => {
    expect(isPlausibleTest(TEST_CODE)).toBe(true);
    expect(isPlausibleTest("const x = 1;")).toBe(false);
    expect(isPlausibleTest("describe('x', () => {})")).toBe(false);
  });
});

describe("buildPrompt", () => {
  it("asks the model to fix every failure in a correction pass", () => {
    const prompt = buildPrompt(
      input({
        provider: "openai",
        previous: { code: "old test", output: "lint failed\nbun test failed" },
      }),
    );
    expect(prompt).toContain("Fix every failure");
    expect(prompt).toContain("lint failed");
    expect(prompt).toContain("bun test failed");
  });

  it("targets measured uncovered lines and branches, bounded", () => {
    const prompt = buildPrompt(
      input({
        provider: "openai",
        coverageHint: {
          path: "src/math.ts",
          uncoveredLines: [42, 43, 44, 58, 71, 80],
          uncoveredBranches: [12, 30, 44, 55, 66, 77],
        },
      }),
    );
    expect(prompt).toContain("Uncovered lines: 42-44, 58, 71, 80");
    expect(prompt).toContain("Uncovered branches on lines: 12, 30, 44, 55, 66");
    expect(prompt).not.toContain("77");
  });

  it("adds no targeting note without a measured hint", () => {
    expect(buildPrompt(input({ provider: "openai" }))).not.toContain("Uncovered lines");
  });

  it("asks for labelled, seeded, bounded fast-check properties when opted in", () => {
    const prompt = buildPrompt(
      input({ provider: "openai", propertyTests: { runs: 50, seed: 42 } }),
    );
    expect(prompt).toContain("fast-check");
    expect(prompt).toContain("numRuns: 50");
    expect(prompt).toContain("seed: 42");
    expect(prompt).toContain("[property]");
  });
});

describe("generateTest", () => {
  it("sends the key upstream but never into the prompt", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return openAiReply(TEST_CODE);
    }) as unknown as typeof fetch;

    const code = await generateTest({ ...input({ provider: "openai" }), fetchImpl: fakeFetch });
    expect(code).toBe(TEST_CODE);

    const call = calls[0];
    expect(call?.url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-secret");
    expect(String(call?.init.body)).not.toContain("sk-secret");
  });

  it("reports the calls the provider says are left", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "```ts\n" + TEST_CODE + "\n```" } }] }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-limit-requests": "10000",
            "x-ratelimit-remaining-requests": "8431",
            "x-ratelimit-reset-requests": "3600",
          },
        },
      )) as unknown as typeof fetch;

    const seen: RateLimitInfo[] = [];
    await generateTest({
      ...input({ provider: "openai" }),
      fetchImpl: fakeFetch,
      onRateLimit: (info) => seen.push(info),
    });

    expect(seen).toEqual([
      { provider: "openai", limit: 10000, remaining: 8431, resetSeconds: 3600 },
    ]);
  });

  it("says nothing about the limit when the provider stays quiet", async () => {
    const fakeFetch = (async () => openAiReply(TEST_CODE)) as unknown as typeof fetch;
    const seen: RateLimitInfo[] = [];
    await generateTest({
      ...input({ provider: "openai" }),
      fetchImpl: fakeFetch,
      onRateLimit: (info) => seen.push(info),
    });
    expect(seen).toEqual([]);
  });

  it("probes the provider for the calls it has left, without a completion", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "x-ratelimit-remaining-requests": "12" },
      });
    }) as unknown as typeof fetch;

    const info = await probeRateLimit({
      config: input({ provider: "openai" }).config,
      fetchImpl: fakeFetch,
    });

    expect(info).toEqual({ provider: "openai", remaining: 12 });
    expect(calls[0]).toBe("https://api.openai.com/v1/models");
  });

  it("says nothing about the limit when the provider does not answer", async () => {
    const fakeFetch = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const info = await probeRateLimit({
      config: input({ provider: "openai" }).config,
      fetchImpl: fakeFetch,
    });
    expect(info).toBeUndefined();
  });

  it("reads the answer out of a Gemini reply that carries its thinking", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  { text: "Let me think about the edge cases first.", thought: true },
                  { text: "```ts\n" + TEST_CODE + "\n```" },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const code = await generateTest({
      ...input({ provider: "google" }),
      fetchImpl: fakeFetch,
    });
    expect(code).toBe(TEST_CODE);
  });

  it("says when Gemini ran out of output tokens", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "MAX_TOKENS",
              content: { parts: [{ text: "thinking out loud" }] },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    await expect(
      generateTest({ ...input({ provider: "google" }), fetchImpl: fakeFetch }),
    ).rejects.toThrow(/ran out of output tokens/);
  });

  it("says a slow provider did not answer in time", async () => {
    const fakeFetch = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as unknown as typeof fetch;

    await expect(
      generateTest({ ...input({ provider: "openai" }), fetchImpl: fakeFetch }),
    ).rejects.toThrow(/did not answer within/);
  });

  it("uses the caller's private base URL", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return openAiReply(TEST_CODE);
    }) as unknown as typeof fetch;

    const { config: base } = input({ provider: "private" });
    const code = await generateTest({
      ...input({ provider: "private" }),
      config: { ...base, model: "qwen2.5-coder", apiKey: undefined, baseUrl: "http://box:8080/v1" },
      fetchImpl: fakeFetch,
    });

    expect(code).toBe(TEST_CODE);
    expect(calls[0]).toBe("http://box:8080/v1/chat/completions");
  });

  it("explains that Workers AI is unbound instead of failing cryptically", async () => {
    const { config: base } = input({ provider: "workers-ai" });
    await expect(
      generateTest({
        ...input({ provider: "workers-ai" }),
        config: { ...base, apiKey: undefined },
      }),
    ).rejects.toThrow(/Workers AI is not bound/);
  });

  it("calls Workers AI over REST when an account ID and token are supplied", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return openAiReply(TEST_CODE);
    }) as unknown as typeof fetch;
    const { config: base } = input({ provider: "workers-ai" });
    const accountId = "0123456789abcdef0123456789abcdef";

    const code = await generateTest({
      ...input({ provider: "workers-ai" }),
      config: { ...base, apiKey: "cf-token", accountId },
      fetchImpl: fakeFetch,
    });

    expect(code).toBe(TEST_CODE);
    const call = calls[0];
    if (!call) throw new Error("Workers AI did not make a request");
    expect(call.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
    );
    expect((call.init.headers as Record<string, string>).authorization).toBe("Bearer cf-token");
  });

  it("rejects a reply that is not a test", async () => {
    const fakeFetch = (async () => openAiReply("const answer = 42;")) as unknown as typeof fetch;
    await expect(
      generateTest({ ...input({ provider: "openai" }), fetchImpl: fakeFetch }),
    ).rejects.toThrow(/did not return a test file/);
  });

  it("reports the usage the provider states", async () => {
    const seen: TokenUsage[] = [];
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "```ts\n" + TEST_CODE + "\n```" } }],
          usage: { prompt_tokens: 120, completion_tokens: 80 },
        }),
      )) as unknown as typeof fetch;

    await generateTest({
      ...input({ provider: "openai" }),
      fetchImpl: fakeFetch,
      onUsage: (usage) => seen.push(usage),
    });

    expect(seen).toEqual([{ input: 120, output: 80 }]);
  });

  it("falls back to the next model once on a retryable failure and says so", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const notices: string[] = [];
    let calls = 0;
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (calls === 1) return new Response("busy", { status: 429 });
      return openAiReply(TEST_CODE);
    }) as unknown as typeof fetch;

    const base = input({ provider: "openai" });
    const code = await generateTest({
      ...base,
      config: { ...base.config, fallbackModel: "gpt-6.1-sol" },
      fetchImpl: fakeFetch,
      onNotice: (text) => notices.push(text),
    });

    expect(code).toBe(TEST_CODE);
    expect(bodies[1]?.model).toBe("gpt-6.1-sol");
    expect(notices[0]).toContain("falling back to gpt-6.1-sol");
  });

  it("does not fall back on a non-retryable refusal", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      return new Response("bad request", { status: 400 });
    }) as unknown as typeof fetch;

    const base = input({ provider: "openai" });
    await expect(
      generateTest({
        ...base,
        config: { ...base.config, fallbackModel: "gpt-6.1-sol" },
        fetchImpl: fakeFetch,
      }),
    ).rejects.toThrow(/returned 400/);
    expect(calls).toBe(1);
  });
});

describe("estimatePromptTokens", () => {
  it("returns a bounded range from the prompt size", () => {
    const estimate = estimatePromptTokens(input({ provider: "openai" }));
    expect(estimate.low).toBeGreaterThan(0);
    expect(estimate.high).toBeGreaterThan(estimate.low);
  });
});
