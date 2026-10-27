import { describe, expect, it } from "bun:test";
import { parseLcov } from "../src/coverage";
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

  it("requires a labelled, seeded, bounded property when opted in", () => {
    const property = `import * as fc from "fast-check";
import { describe, it, expect } from "bun:test";

describe("add", () => {
  it("[property] adds integers", () => {
    fc.assert(fc.property(fc.integer(), (n) => expect(typeof n).toBe("number")), {
      numRuns: 50,
      seed: 42,
    });
  });
});`;
    expect(staticCheck(property, true, true)).toEqual([]);
    expect(
      staticCheck(GOOD, true, true)
        .map((problem) => problem.problem)
        .join(" "),
    ).toContain("fast-check");
    expect(
      staticCheck(property.replace("seed: 42", ""), true, true)
        .map((problem) => problem.problem)
        .join(" "),
    ).toContain("seed");
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

  it("targets the generated file after the runner clones a v2 repository", async () => {
    let body: Record<string, unknown> = {};
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ exitCode: 0, stdout: "1 pass" }));
    }) as unknown as typeof fetch;

    const result = await validateTest({
      ...base,
      sandbox: { url: "https://runner.example", v2: true },
      repo: { url: "https://github.com/acme/api.git", ref: "main" },
      fetchImpl: fakeFetch,
    });

    expect(result.verified).toBe(true);
    expect(body.repo).toEqual({ url: "https://github.com/acme/api.git", ref: "main" });
    expect(body.command).toBe("bun test 'src/math.test.ts'");
  });

  it("asks for LCOV and reports a delta only when both reports measured", async () => {
    let body: Record<string, unknown> = {};
    const after = ["SF:src/math.ts", "DA:1,1", "DA:2,1", "end_of_record"].join("\n");
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          exitCode: 0,
          stdout: "1 pass",
          artifacts: { "coverage/lcov.info": after },
        }),
      );
    }) as unknown as typeof fetch;

    const result = await validateTest({
      ...base,
      sandbox: { url: "https://runner.example", coverage: true },
      measureCoverage: true,
      baselineCoverage: parseLcov("SF:src/math.ts\nDA:1,1\nDA:2,0\nend_of_record"),
      fetchImpl: fakeFetch,
    });

    expect(body.coverage).toEqual({ format: "lcov" });
    expect(result.coverage).toEqual({
      status: "measured",
      path: "src/math.ts",
      lines: { before: 1, after: 2, delta: 1, total: 2 },
    });
  });

  it("says not-measured when the runner returns no report", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ exitCode: 0, stdout: "1 pass" }))) as unknown as typeof fetch;
    const result = await validateTest({
      ...base,
      sandbox: { url: "https://runner.example", coverage: true },
      measureCoverage: true,
      baselineCoverage: parseLcov("SF:src/math.ts\nDA:1,1\nend_of_record"),
      fetchImpl: fakeFetch,
    });

    expect(result.coverage).toEqual({ status: "not-measured" });
  });

  it("runs the detected runner command for a repository", async () => {
    let body: Record<string, unknown> = {};
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ exitCode: 0, stdout: "1 pass" }));
    }) as unknown as typeof fetch;

    await validateTest({
      ...base,
      sandbox: { url: "https://runner.example", v2: true },
      repo: { url: "https://github.com/acme/api.git", ref: "main" },
      runner: "vitest",
      packageManager: "npm",
      flakyRuns: 0,
      fetchImpl: fakeFetch,
    });

    expect(body.command).toBe("npx vitest run 'src/math.test.ts'");
  });

  it("marks a pass/fail split flaky, quarantined and never verified", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          exitCode: calls === 2 ? 1 : 0,
          stdout: calls === 2 ? "1 fail" : "1 pass",
        }),
      );
    }) as unknown as typeof fetch;

    const result = await validateTest({
      ...base,
      sandbox: { url: "https://runner.example" },
      flakyRuns: 2,
      fetchImpl: fakeFetch,
    });

    expect(result).toMatchObject({ ok: false, verified: false, flaky: true, runs: 2 });
    expect(result.output).toContain("Flaky, quarantined");
  });

  it("keeps a stable suite verified after its repeats", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ exitCode: 0, stdout: "1 pass" }));
    }) as unknown as typeof fetch;

    const result = await validateTest({
      ...base,
      sandbox: { url: "https://runner.example" },
      flakyRuns: 2,
      fetchImpl: fakeFetch,
    });

    expect(result).toMatchObject({ ok: true, verified: true, runs: 3 });
    expect(result.flaky).toBeUndefined();
    expect(calls).toBe(3);
  });

  it("measures mutation only when the configured tool returns a report", async () => {
    let calls = 0;
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { command: string };
      if (body.command.includes("stryker")) {
        return new Response(
          JSON.stringify({
            exitCode: 0,
            artifacts: {
              "reports/mutation/mutation.json": JSON.stringify({
                killed: 3,
                survived: 1,
                mutationScore: 75,
              }),
            },
          }),
        );
      }
      return new Response(JSON.stringify({ exitCode: 0, stdout: "1 pass" }));
    }) as unknown as typeof fetch;

    const result = await validateTest({
      ...base,
      sandbox: { url: "https://runner.example" },
      flakyRuns: 0,
      mutationCommand: "npx stryker run --mutate {file}",
      fetchImpl: fakeFetch,
    });

    expect(calls).toBe(2);
    expect(result.mutation).toMatchObject({
      status: "measured",
      killed: 3,
      survived: 1,
      score: 75,
    });
  });

  it("says mutation is not measured when the tool returns no report", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ exitCode: 0, stdout: "1 pass" }))) as unknown as typeof fetch;
    const result = await validateTest({
      ...base,
      sandbox: { url: "https://runner.example" },
      flakyRuns: 0,
      mutationCommand: "npx stryker run",
      fetchImpl: fakeFetch,
    });
    expect(result.mutation).toMatchObject({ status: "not-measured" });
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
