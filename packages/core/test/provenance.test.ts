import { describe, expect, it } from "bun:test";
import { pullRequestBody } from "../src/provenance";

describe("pullRequestBody", () => {
  it("states the model, verification, checks, coverage, corrections and skips", () => {
    const body = pullRequestBody({
      provider: "OpenAI",
      model: "gpt-6",
      files: [
        {
          sourcePath: "src/a.ts",
          testPath: "src/a.test.ts",
          verified: true,
          corrected: true,
          checks: [
            {
              name: "bun test",
              kind: "test",
              command: "bun test",
              ok: true,
              durationMs: 1200,
            },
          ],
          coverage: {
            status: "measured",
            path: "src/a.ts",
            lines: { before: 1, after: 4, delta: 3, total: 10 },
            branches: { before: 0, after: 1, delta: 1, total: 2 },
          },
        },
        { sourcePath: "src/b.ts", testPath: "src/b.test.ts", verified: false },
      ],
      skipped: [{ method: "GET", path: "/users", reason: "missing auth fixture" }],
      testOnly: true,
    });

    expect(body).toContain("Generated with OpenAI · gpt-6.");
    expect(body).toContain("1 executed on the runner, 1 static only");
    expect(body).toContain("`bun test` (bun test) · 1200 ms · passed");
    expect(body).toContain("+3 covered lines (4/10), +1 branches (1/2)");
    expect(body).toContain("self-corrected");
    expect(body).toContain("GET /users`: missing auth fixture");
    expect(body).toContain("Only test artifacts");
  });

  it("changes when verification changes and says not measured without reports", () => {
    const staticOnly = pullRequestBody({
      files: [{ sourcePath: "src/a.ts", testPath: "src/a.test.ts", verified: false }],
    });
    const executed = pullRequestBody({
      files: [{ sourcePath: "src/a.ts", testPath: "src/a.test.ts", verified: true }],
    });

    expect(staticOnly).toContain("static check only");
    expect(staticOnly).toContain("Not measured");
    expect(executed).toContain("executed on the runner");
    expect(executed).not.toBe(staticOnly);
  });

  it("does not claim verification when the caller did not report it", () => {
    const body = pullRequestBody({
      files: [{ sourcePath: "src/a.ts", testPath: "src/a.test.ts" }],
    });
    expect(body).toContain("verification not reported");
    expect(body).not.toContain(": executed on the runner.");
  });
});
