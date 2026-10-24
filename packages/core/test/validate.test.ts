import { describe, expect, it } from "bun:test";
import { staticCheck, validateTest } from "../src/validate";

const GOOD = `import { describe, it, expect } from "bun:test";
import { add } from "./math";

describe("add", () => {
  it("adds", () => {
    expect(add(1, 2)).toBe(3);
  });
});`;

describe("staticCheck", () => {
  it("passes a well-formed test", () => {
    expect(staticCheck(GOOD, true)).toEqual([]);
  });

  it("catches fences, missing assertions and unbalanced braces", () => {
    const problems = staticCheck("```ts\nconst x = 1;\n```", true).map((p) => p.problem);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" ")).toContain("Markdown fence");
    expect(staticCheck("describe('x', () => { expect(1).toBe(1);", false)[0]?.problem).toContain(
      "Unbalanced braces",
    );
  });

  it("enforces strict mode when asked", () => {
    const loose = GOOD.replace("add(1, 2)", "add(1 as any, 2)");
    expect(staticCheck(GOOD, true)).toEqual([]);
    expect(
      staticCheck(loose, true)
        .map((p) => p.problem)
        .join(" "),
    ).toContain("as any");
    expect(staticCheck(loose, false)).toEqual([]);
  });
});

describe("validateTest", () => {
  const base = {
    sourcePath: "src/math.ts",
    source: "export const add = (a: number, b: number) => a + b;",
    testPath: "src/math.test.ts",
    test: GOOD,
    strictTypes: true,
  };

  it("is honest when no sandbox is configured", async () => {
    const result = await validateTest(base);
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.output).toContain("not executed");
  });

  it("reports a failed static check without calling the runner", async () => {
    let called = false;
    const fakeFetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;

    const result = await validateTest({
      ...base,
      test: "not a test",
      sandbox: { url: "https://runner.example" },
      fetchImpl: fakeFetch,
    });

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("runs the sandbox contract and reports real coverage of the result", async () => {
    let body: unknown;
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ exitCode: 0, stdout: "2 pass" }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await validateTest({
      ...base,
      sandbox: { url: "https://runner.example", apiKey: "runner-key" },
      fetchImpl: fakeFetch,
    });

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.output).toBe("2 pass");
    const files = (body as { files: Record<string, string>; command: string }).files;
    expect(Object.keys(files)).toEqual(["src/math.ts", "src/math.test.ts"]);
    expect((body as { command: string }).command).toBe("bun test");
  });

  it("does not claim verification when the runner is unreachable", async () => {
    const fakeFetch = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    const result = await validateTest({
      ...base,
      sandbox: { url: "https://runner.example" },
      fetchImpl: fakeFetch,
    });

    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.output).toContain("Sandbox unreachable");
  });
});
