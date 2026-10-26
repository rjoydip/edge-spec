import { describe, expect, it } from "bun:test";
import { assertTestOnly, isTestPath, PolicyError, testPathProblem } from "../src/policy";

describe("testPathProblem", () => {
  it("allows test files and files inside test directories", () => {
    for (const path of [
      "src/a.test.ts",
      "src/a.spec.tsx",
      "tests/api/openapi.contract.test.ts",
      "tests/helpers.ts",
      "__tests__/a.ts",
      "test/setup.ts",
      "e2e/login.spec.js",
    ]) {
      expect(testPathProblem(path)).toBeUndefined();
      expect(isTestPath(path)).toBe(true);
    }
  });

  it("rejects source, generated, declaration and lockfile paths", () => {
    for (const path of [
      "src/a.ts",
      "dist/a.test.ts",
      "build/a.spec.ts",
      "coverage/a.test.ts",
      "vendor/a.spec.ts",
      "migrations/001.test.ts",
      "node_modules/a/a.test.ts",
      "src/types.d.ts",
      "bun.lock",
      "package-lock.json",
    ]) {
      expect(testPathProblem(path)).toBeDefined();
      expect(isTestPath(path)).toBe(false);
    }
  });

  it("rejects paths that escape the repository or use the wrong separator", () => {
    for (const path of [
      "",
      "../a.test.ts",
      "src/../a.test.ts",
      "/etc/passwd.test.ts",
      "C:\\repo\\a.test.ts",
      "src\\a.test.ts",
    ]) {
      expect(testPathProblem(path)).toBeDefined();
    }
  });
});

describe("assertTestOnly", () => {
  it("names the path and the reason it refuses", () => {
    expect(() => assertTestOnly("src/a.ts")).toThrow(PolicyError);
    try {
      assertTestOnly("src/a.ts");
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyError);
      expect((error as PolicyError).path).toBe("src/a.ts");
      expect((error as Error).message).toContain("only test files");
    }
  });

  it("accepts a test artifact", () => {
    expect(() => assertTestOnly("tests/a.test.ts")).not.toThrow();
  });
});
