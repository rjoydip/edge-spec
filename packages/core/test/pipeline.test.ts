import { describe, expect, it } from "bun:test";
import { runPipeline } from "../src/pipeline";
import type { GitHub } from "../src/github";
import { providerById } from "../src/catalog";
import type { RunEvent } from "../src/types";

const TEST_CODE = `import { describe, it, expect } from "bun:test";
import { add } from "./math";

describe("add", () => {
  it("adds two numbers", () => {
    expect(add(1, 2)).toBe(3);
  });
});`;

/** Records the arguments so a wrong call order cannot pass unnoticed. */
function fakeGitHub(calls: string[]): GitHub {
  return {
    tree: async (repo: string, ref: string) => {
      calls.push(`tree:${repo}@${ref}`);
      return [
        { path: "src/math.ts", type: "blob" },
        { path: "src/math.test.ts", type: "blob" },
        { path: "src/untested.ts", type: "blob" },
        { path: "src/other.ts", type: "blob" },
        { path: "test/mock.ts", type: "blob" },
      ];
    },
    file: async (repo: string, path: string, ref: string) => {
      calls.push(`file:${repo}:${path}@${ref}`);
      return "export const add = (a: number, b: number) => a + b;";
    },
    defaultBranch: async () => "main",
    headSha: async () => "sha123",
    createBranch: async (_repo: string, branch: string) => {
      calls.push(`branch:${branch}`);
    },
    putFile: async (_repo: string, path: string, code: string) => {
      calls.push(`put:${path}:${code.length > 0 ? "code" : "empty"}`);
    },
    openPull: async () => "https://github.com/acme/api/pull/7",
  } as unknown as GitHub;
}

const aiFetch = (async () =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: "```ts\n" + TEST_CODE + "\n```" } }] }),
    { status: 200 },
  )) as unknown as typeof fetch;

const input = {
  repo: "acme/api",
  ref: "release/2.0",
  maxRetries: 0,
  maxAiRetries: 2,
  strictTypes: true,
  coverageTarget: 90,
  maxFiles: 10,
};

describe("runPipeline", () => {
  it("scans and generates with the right repo and ref, then waits for a manual PR", async () => {
    const calls: string[] = [];
    const events: RunEvent[] = [];
    const provider = providerById("openai");
    if (!provider) throw new Error("catalog lost openai");

    for await (const event of runPipeline(input, {
      github: fakeGitHub(calls),
      aiConfig: { provider, model: "gpt-6-astra", apiKey: "sk-test" },
      fetchImpl: aiFetch,
    })) {
      events.push(event);
    }

    expect(calls[0]).toBe("tree:acme/api@release/2.0");
    expect(calls.some((call) => call.startsWith("file:acme/api:src/"))).toBe(true);
    // A run never cuts a branch: the reviewer opens the pull request by hand.
    expect(calls.some((call) => call.startsWith("branch:"))).toBe(false);
    expect(calls.some((call) => call.startsWith("put:"))).toBe(false);

    const result = events.find((event) => event.type === "result");
    expect(result).toMatchObject({ type: "result", ok: true });
    expect(
      result && "pullRequestUrl" in result ? result.pullRequestUrl : undefined,
    ).toBeUndefined();

    const pullStep = events.find((event) => event.type === "step" && event.step === "pull-request");
    expect(pullStep).toMatchObject({ type: "step", status: "done" });

    const generation = events.find((event) => event.type === "generation");
    expect(generation).toMatchObject({ type: "generation" });
    expect(
      generation && "generation" in generation ? generation.generation.source : undefined,
    ).toBe("export const add = (a: number, b: number) => a + b;");
    const validation = events.find((event) => event.type === "validation");
    expect(validation).toMatchObject({
      type: "validation",
      validation: { ok: true, verified: false },
    });
  });

  it("generates a test for every gap it covers and reports them as ready", async () => {
    const calls: string[] = [];
    const events: RunEvent[] = [];
    const provider = providerById("openai");
    if (!provider) throw new Error("catalog lost openai");

    for await (const event of runPipeline(
      { ...input, ref: "main", maxFiles: 2 },
      {
        github: fakeGitHub(calls),
        aiConfig: { provider, model: "gpt-6-astra", apiKey: "sk-test" },
        fetchImpl: aiFetch,
      },
    )) {
      events.push(event);
    }

    const generations = events.filter((event) => event.type === "generation");
    expect(generations.length).toBe(2);
    const paths = generations.map((event) =>
      event.type === "generation" ? event.generation.sourcePath : "",
    );
    expect(new Set(paths).size).toBe(2);

    const result = events.find((event) => event.type === "result");
    expect(result).toMatchObject({ type: "result", ok: true });
    expect(result && "ready" in result ? result.ready : undefined).toEqual(paths);
  });

  it("stops before the PR when validation fails", async () => {
    const calls: string[] = [];
    const events: RunEvent[] = [];
    const provider = providerById("openai");
    if (!provider) throw new Error("catalog lost openai");

    for await (const event of runPipeline(
      { ...input, ref: "main" },
      {
        github: fakeGitHub(calls),
        aiConfig: { provider, model: "gpt-6-astra", apiKey: "sk-test" },
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      '```ts\nimport { describe, it, expect } from "bun:test";\n\ndescribe("add", () => {\n  it("adds", () => {\n    expect(1).toBe(1);\n  });\n```',
                  },
                },
              ],
            }),
            { status: 200 },
          )) as unknown as typeof fetch,
      },
    )) {
      events.push(event);
    }

    expect(calls.some((call) => call.startsWith("branch:"))).toBe(false);
    const result = events.find((event) => event.type === "result");
    expect(result).toMatchObject({ type: "result", ok: false });

    // The log carries the reason, not only the word "failed".
    const failure = events.find(
      (event) =>
        event.type === "log" &&
        event.level === "error" &&
        event.text.includes("validation failed:"),
    );
    expect(failure).toBeDefined();

    // Validation starts before it runs, so its log is tagged to the Validate stage.
    expect(
      events.some(
        (event) => event.type === "step" && event.step === "validate" && event.status === "start",
      ),
    ).toBe(true);
  });
});
