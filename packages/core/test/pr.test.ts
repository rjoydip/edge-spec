import { describe, expect, it } from "bun:test";
import { pullFilesOf, pullMetaOf, slugOf, validBranchName } from "../src/pr";

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
