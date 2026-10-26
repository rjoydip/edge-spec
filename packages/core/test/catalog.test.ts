import { describe, expect, it } from "bun:test";
import {
  DEFAULT_AI,
  nextModel,
  normalizeModel,
  parseRef,
  parseRepo,
  parseRepoInput,
  parseSandboxUrl,
  pipelineConfig,
  providerById,
  resolveAi,
} from "../src/catalog";
import { HttpError } from "../src/types";

describe("parseRepo", () => {
  it("accepts owner/name, URLs and clone URLs", () => {
    expect(parseRepo("cloudflare/workers-sdk")).toEqual({
      owner: "cloudflare",
      name: "workers-sdk",
    });
    expect(parseRepo("https://github.com/acme/api.git")).toEqual({ owner: "acme", name: "api" });
    expect(parseRepo("  git@github.com:acme/api.git ")).toEqual({ owner: "acme", name: "api" });
  });

  it("rejects malformed and traversal input", () => {
    for (const input of ["", "acme", "acme/api/extra", "acme/..", "../api", "acme/a b"]) {
      expect(parseRepo(input)).toBeNull();
    }
  });
});

describe("parseRepoInput", () => {
  it("accepts a repository, a folder path and a tree URL", () => {
    expect(parseRepoInput("acme/api")).toEqual({ owner: "acme", name: "api" });
    expect(parseRepoInput("acme/api/src/core")).toEqual({
      owner: "acme",
      name: "api",
      folder: "src/core",
    });
    expect(parseRepoInput("https://github.com/acme/api/tree/main/src/core")).toEqual({
      owner: "acme",
      name: "api",
      folder: "src/core",
      ref: "main",
    });
    expect(parseRepoInput("https://github.com/acme/api/tree/feature%2Ffoo/src")).toEqual({
      owner: "acme",
      name: "api",
      folder: "src",
      ref: "feature/foo",
    });
    expect(parseRepoInput("https://github.com/acme/api/tree/main")).toEqual({
      owner: "acme",
      name: "api",
      ref: "main",
    });
  });

  it("rejects traversal and malformed folders", () => {
    for (const input of [
      "",
      "acme",
      "acme/..",
      "acme/api/../secret",
      "acme/api/%2e%2e/secret",
      "acme/api/tree",
      "acme/api/tree/main/..",
      "/home/user/app",
    ]) {
      expect(parseRepoInput(input)).toBeNull();
    }
  });
});

describe("parseRef", () => {
  it("defaults to main and rejects traversal", () => {
    expect(parseRef(undefined)).toBe("main");
    expect(parseRef("release/1.0")).toBe("release/1.0");
    expect(() => parseRef("../evil")).toThrow(HttpError);
    expect(() => parseRef("a b")).toThrow(HttpError);
  });
});

describe("normalizeModel", () => {
  it("drops a retired model but keeps a current or custom one", () => {
    expect(normalizeModel("workers-ai", "@cf/meta/llama-3.3-70b-instruct")).toBe(DEFAULT_AI.model);
    expect(normalizeModel("openai", "gpt-6-astra")).toBe("gpt-6-astra");
    expect(normalizeModel("private", "my-local-model")).toBe("my-local-model");
  });

  it("falls back when a provider retires a model", () => {
    // Gemini 2.0 Flash is gone; a stored id must not keep asking for it.
    expect(normalizeModel("google", "gemini-2.0-flash")).toBe("gemini-3.8-flash");
    expect(normalizeModel("openai", "gpt-4o")).toBe("gpt-6-astra");
    // A model that is still offered is kept, 2.5 family included.
    expect(normalizeModel("google", "gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });
});

describe("resolveAi", () => {
  it("defaults to Workers AI without a key", () => {
    const choice = resolveAi({});
    expect(choice.provider.id).toBe(DEFAULT_AI.provider);
    expect(choice.model).toBe(DEFAULT_AI.model);
    expect(choice.apiKey).toBeUndefined();
  });

  it("accepts Workers AI BYOK with a Cloudflare account ID", () => {
    const accountId = "0123456789abcdef0123456789abcdef";
    const choice = resolveAi({
      provider: "workers-ai",
      model: DEFAULT_AI.model,
      apiKey: "cf-token",
      accountId,
    });
    expect(choice.accountId).toBe(accountId);
    expect(choice.apiKey).toBe("cf-token");
    expect(() =>
      resolveAi({ provider: "workers-ai", model: DEFAULT_AI.model, accountId: "not-an-id" }),
    ).toThrow(/32 hexadecimal/);
  });

  it("needs the account ID and the token together for Workers AI", () => {
    const accountId = "0123456789abcdef0123456789abcdef";
    // One without the other is a mistake, not a half configuration.
    expect(() => resolveAi({ provider: "workers-ai", model: DEFAULT_AI.model, accountId })).toThrow(
      /both the Cloudflare account ID and the API token/,
    );
    expect(() =>
      resolveAi({ provider: "workers-ai", model: DEFAULT_AI.model, apiKey: "cf-token" }),
    ).toThrow(/both the Cloudflare account ID and the API token/);
    // Both, or neither.
    expect(
      resolveAi({
        provider: "workers-ai",
        model: DEFAULT_AI.model,
        apiKey: "cf-token",
        accountId,
      }).accountId,
    ).toBe(accountId);
    expect(
      resolveAi({ provider: "workers-ai", model: DEFAULT_AI.model }).accountId,
    ).toBeUndefined();
  });

  it("requires a key for a hosted provider", () => {
    expect(() => resolveAi({ provider: "openai", model: "gpt-6-astra" })).toThrow(
      /requires your API key/,
    );
  });

  it("does not let a caller redirect a known provider's key", () => {
    const choice = resolveAi({
      provider: "openai",
      model: "gpt-6-astra",
      apiKey: "sk-test",
      baseUrl: "https://evil.example",
    });
    expect(choice.baseUrl).toBe(providerById("openai")?.baseUrl ?? "");
  });

  it("accepts a private provider with a base URL and optional key", () => {
    const choice = resolveAi({
      provider: "private",
      model: "qwen2.5-coder",
      baseUrl: "http://localhost:11434/v1/",
    });
    expect(choice.baseUrl).toBe("http://localhost:11434/v1");
    expect(choice.apiKey).toBeUndefined();
    expect(() => resolveAi({ provider: "private", model: "x" })).toThrow(/base URL/);
    expect(() =>
      resolveAi({ provider: "private", model: "x", baseUrl: "file:///etc/passwd" }),
    ).toThrow(/http or https/);
  });

  it("rejects a model that does not belong to the provider", () => {
    expect(() =>
      resolveAi({ provider: "openai", model: "gpt-6-astra", apiKey: "k" }),
    ).not.toThrow();
    expect(() =>
      resolveAi({ provider: "openai", model: "claude-sonnet-5-5", apiKey: "k" }),
    ).toThrow(/not available/);
  });
});

describe("pipelineConfig", () => {
  it("clamps retries, coverage and file count into a safe range", () => {
    expect(
      pipelineConfig({ maxRetries: 99, coverageTarget: -4, autoPr: false, maxFiles: 900 }),
    ).toEqual({
      maxRetries: 5,
      maxAiRetries: 2,
      autoPr: false,
      strictTypes: true,
      coverageTarget: 0,
      maxFiles: 50,
      parallelGeneration: true,
      concurrency: 3,
      maxTokens: 0,
      flakyRuns: 2,
      mutationCommand: "",
      propertyTests: false,
    });
    expect(pipelineConfig({ maxRetries: "x" }).maxRetries).toBe(2);
    expect(pipelineConfig({ maxFiles: 0 }).maxFiles).toBe(1);
    expect(pipelineConfig({ concurrency: 99 }).concurrency).toBe(6);
    expect(pipelineConfig({ concurrency: 0 }).concurrency).toBe(1);
    expect(pipelineConfig({ maxTokens: 5000 }).maxTokens).toBe(5000);
    expect(pipelineConfig({ maxTokens: -5 }).maxTokens).toBe(0);
    expect(pipelineConfig({ maxTokens: 9_000_000 }).maxTokens).toBe(2_000_000);
    expect(pipelineConfig({ flakyRuns: 3 }).flakyRuns).toBe(3);
    expect(pipelineConfig({ flakyRuns: -1 }).flakyRuns).toBe(0);
    expect(pipelineConfig({ flakyRuns: 99 }).flakyRuns).toBe(5);
    expect(pipelineConfig({ propertyTests: true }).propertyTests).toBe(true);
    expect(pipelineConfig({ propertyTests: "yes" }).propertyTests).toBe(false);
  });
});

describe("nextModel", () => {
  it("picks the next catalog model and stops at the end", () => {
    const google = providerById("google");
    if (!google) throw new Error("catalog lost google");
    expect(nextModel(google, "gemini-3.8-flash")).toBe("gemini-3.6-flash");
    expect(nextModel(google, "gemini-2.5-flash")).toBeUndefined();
  });
});

describe("parseSandboxUrl", () => {
  it("accepts https and a local runner, and refuses anything else", () => {
    expect(parseSandboxUrl("https://runner.example.com")).toBe("https://runner.example.com/");
    expect(parseSandboxUrl("http://localhost:8788")).toBe("http://localhost:8788/");
    expect(parseSandboxUrl("http://10.0.0.4:8788")).toBeNull();
    expect(parseSandboxUrl("file:///etc/passwd")).toBeNull();
    expect(parseSandboxUrl("not a url")).toBeNull();
    expect(parseSandboxUrl("")).toBeNull();
  });
});
