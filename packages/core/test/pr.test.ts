import { describe, expect, it } from "bun:test";
import { pullFilesOf, pullMetaOf, pullSkippedOf, slugOf, validBranchName } from "../src/pr";
import { PolicyError } from "../src/policy";

describe("pullFilesOf", () => {
  it("reads a batch of test files so one pull request can carry them", () => {
    const files = pullFilesOf({
      files: [
        { path: "src/a.test.ts", code: "test a", sourcePath: "src/a.ts" },
        { path: "src/b.test.ts", code: "test b", sourcePath: "src/b.ts" },
      ],
    });
    expect(files).toEqual([
      { path: "src/a.test.ts", code: "test a", sourcePath: "src/a.ts" },
      { path: "src/b.test.ts", code: "test b", sourcePath: "src/b.ts" },
    ]);
  });

  it("falls back to a single test", () => {
    expect(
      pullFilesOf({ sourcePath: "src/a.ts", testPath: "src/a.test.ts", code: "test a" }),
    ).toEqual([{ path: "src/a.test.ts", code: "test a", sourcePath: "src/a.ts" }]);
  });

  it("ignores entries without a path or code", () => {
    expect(
      pullFilesOf({
        files: [{ path: "src/a.test.ts" }, { code: "orphan" }, null, "nonsense"],
      }),
    ).toEqual([]);
    expect(pullFilesOf({})).toEqual([]);
  });

  it("refuses a source path instead of uploading it", () => {
    expect(() =>
      pullFilesOf({ files: [{ path: "src/a.ts", code: "test a", sourcePath: "src/a.ts" }] }),
    ).toThrow(PolicyError);
    expect(() =>
      pullFilesOf({ sourcePath: "src/a.ts", testPath: "src/a.ts", code: "test a" }),
    ).toThrow(PolicyError);
  });

  it("keeps provenance but never check output", () => {
    const [file] = pullFilesOf({
      files: [
        {
          path: "src/a.test.ts",
          code: "test a",
          sourcePath: "src/a.ts",
          provider: "OpenAI",
          model: "gpt-6",
          verified: true,
          corrected: true,
          checks: [
            {
              name: "bun test",
              kind: "test",
              command: "bun test",
              ok: true,
              durationMs: 12,
              output: "source text must not be stored",
            },
          ],
          coverage: {
            status: "measured",
            path: "src/a.ts",
            lines: { before: 0, after: 2, delta: 2, total: 3 },
          },
        },
      ],
    });

    expect(file).toMatchObject({
      provider: "OpenAI",
      model: "gpt-6",
      verified: true,
      corrected: true,
      checks: [{ name: "bun test", durationMs: 12 }],
      coverage: { status: "measured", lines: { delta: 2 } },
    });
    const check = file?.checks?.[0];
    expect(check).toBeDefined();
    expect(check && "output" in check).toBe(false);
  });

  it("reads skipped contract operations with their reasons", () => {
    expect(
      pullSkippedOf({
        skipped: [
          { method: "get", path: "/users", reason: " missing auth fixture " },
          { method: "POST" },
        ],
      }),
    ).toEqual([{ method: "GET", path: "/users", reason: "missing auth fixture" }]);
  });

  it("uses the test path when no source path is given", () => {
    expect(pullFilesOf({ files: [{ path: "src/a.test.ts", code: "x" }] })).toEqual([
      { path: "src/a.test.ts", code: "x", sourcePath: "src/a.test.ts" },
    ]);
  });
});

describe("pullMetaOf", () => {
  it("keeps the provided title, body, branch, commit and draft flag", () => {
    expect(
      pullMetaOf({
        title: "  test: cover auth  ",
        body: "## Summary",
        branch: "edgespec/tests-1",
        commitMessage: "test: add auth tests",
        draft: true,
      }),
    ).toEqual({
      title: "test: cover auth",
      body: "## Summary",
      branch: "edgespec/tests-1",
      commitMessage: "test: add auth tests",
      draft: true,
    });
  });

  it("omits blank fields", () => {
    expect(pullMetaOf({ title: " ", body: "", branch: "", draft: false })).toEqual({});
  });
});

describe("validBranchName", () => {
  it("accepts safe feature branches", () => {
    expect(validBranchName("edgespec/tests-2026-10-25")).toBe(true);
    expect(validBranchName("feature/auth-tests")).toBe(true);
  });

  it("rejects protected, malformed or unsafe refs", () => {
    for (const branch of [
      "",
      "main",
      "master",
      "HEAD",
      "-bad",
      "/bad",
      "bad/",
      "a..b",
      "a b",
      "a//b",
      "refs/heads/x",
      "x.lock",
      "a@{1}",
    ]) {
      expect(validBranchName(branch)).toBe(false);
    }
  });
});

describe("slugOf", () => {
  it("turns a path into a branch fragment", () => {
    expect(slugOf("src/Auth Service.ts")).toBe("auth-service");
    expect(slugOf("src/math.test.ts")).toBe("math-test");
    expect(slugOf("")).toBe("tests");
  });
});
