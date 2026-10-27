import { describe, expect, it } from "bun:test";
import {
  classifyTree,
  describeRepository,
  expectedTestPath,
  extractExports,
  findGaps,
  folderFirst,
  isSourceFile,
  packageFacts,
  skippedPathReason,
} from "../src/scanner";

describe("expectedTestPath", () => {
  it("puts .test before the extension", () => {
    expect(expectedTestPath("src/auth/jwt.ts")).toBe("src/auth/jwt.test.ts");
    expect(expectedTestPath("src/App.tsx")).toBe("src/App.test.tsx");
    expect(expectedTestPath("src/a.mjs")).toBe("src/a.test.mjs");
  });
});

describe("isSourceFile", () => {
  it("accepts source and refuses tests, declarations, generated output and configs", () => {
    expect(isSourceFile("src/auth/jwt.ts")).toBe(true);
    expect(isSourceFile("packages/api/src/index.ts")).toBe(true);
    for (const path of [
      "src/auth/jwt.test.ts",
      "src/auth/jwt.spec.tsx",
      "src/types.d.ts",
      "dist/index.js",
      "vendor/lib.ts",
      "migrations/001.ts",
      "node_modules/x/y.js",
      "vite.config.ts",
      "src/README.md",
      "test/mock.ts",
      "src/__tests__/helper.ts",
      "packages/api/e2e/setup.ts",
    ]) {
      expect(isSourceFile(path)).toBe(false);
    }
  });
});

describe("skippedPathReason", () => {
  it("names generated, vendored, declaration and lockfile paths", () => {
    for (const path of [
      "dist/a.js",
      "vendor/lib.ts",
      "migrations/001.ts",
      "src/types.d.ts",
      "bun.lock",
    ]) {
      expect(skippedPathReason(path)).toBeDefined();
    }
    expect(skippedPathReason("src/a.ts")).toBeUndefined();
  });
});

describe("findGaps", () => {
  it("reports only files without a sibling test, high risk first", () => {
    const gaps = findGaps([
      "src/auth/jwt.ts",
      "src/auth/jwt.test.ts",
      "src/utils/format.ts",
      "src/utils/format.test.ts",
      "src/billing/invoice.ts",
      "src/services/user.ts",
    ]);

    expect(gaps.map((gap) => gap.path)).toEqual(["src/billing/invoice.ts", "src/services/user.ts"]);
    expect(gaps[0]?.risk).toBe("high");
    expect(gaps[0]?.testPath).toBe("src/billing/invoice.test.ts");
  });

  it("honours the limit", () => {
    const paths = Array.from({ length: 10 }, (_, i) => `src/mod${i}/file.ts`);
    expect(findGaps(paths, 3)).toHaveLength(3);
  });
});

describe("classifyTree", () => {
  it("counts policy-skipped sources instead of creating gaps", () => {
    const result = classifyTree([
      "src/a.ts",
      "dist/a.js",
      "vendor/lib.ts",
      "migrations/001.ts",
      "src/types.d.ts",
    ]);

    expect(result.missing.map((gap) => gap.path)).toEqual(["src/a.ts"]);
    expect(result.skipped).toBe(4);
  });
});

describe("folderFirst", () => {
  const gaps = findGaps([
    "apps/web/src/widget.tsx",
    "packages/api/src/session.ts",
    "packages/api/src/user.ts",
    "src/billing/invoice.ts",
  ]);

  it("starts in a folder without narrowing the scan", () => {
    const ordered = folderFirst(gaps, "packages/api");
    expect(ordered.map((gap) => gap.path)).toEqual([
      "packages/api/src/session.ts",
      "packages/api/src/user.ts",
      "src/billing/invoice.ts",
      "apps/web/src/widget.tsx",
    ]);
    expect(ordered).toHaveLength(gaps.length);
  });

  it("leaves the list alone when the folder has no gaps", () => {
    expect(folderFirst(gaps, "packages/web").map((gap) => gap.path)).toEqual(
      gaps.map((gap) => gap.path),
    );
  });
});

describe("extractExports", () => {
  it("finds common export forms without duplicates", () => {
    const source = `
      export async function signJwt() {}
      export const verifyToken = () => {};
      export class Store {}
      export { helper, other as renamed };
      const notExported = 1;
    `;
    expect(extractExports(source)).toEqual(["signJwt", "Store", "verifyToken", "helper", "other"]);
  });
});

describe("describeRepository", () => {
  it("reads the languages, package manager and tools out of the tree", () => {
    const overview = describeRepository([
      "package.json",
      "bun.lock",
      "tsconfig.json",
      "next.config.js",
      ".nvmrc",
      "src/app.ts",
      "src/app.test.ts",
      "src/util/format.ts",
      "scripts/build.py",
      "README.md",
    ]);

    expect(overview.packageManager).toBe("bun");
    expect(overview.runtime).toBe("node");
    expect(overview.languages[0]).toEqual({ name: "TypeScript", count: 3 });
    expect(overview.languages.map((language) => language.name)).toContain("Python");
    expect(overview.languages.map((language) => language.name)).toContain("JavaScript");
    expect(overview.frameworks).toContain("Next.js");
    expect(overview.frameworks).toContain("TypeScript");
    expect(overview.sourceFiles).toBe(3);
    expect(overview.testFiles).toBe(1);
    expect(overview.totalFiles).toBe(10);
  });
  it("finds OpenAPI specs and Postman/Bruno collections in the tree", () => {
    const overview = describeRepository([
      "openapi.yaml",
      "docs/swagger.json",
      "postman/users.json",
      "acme.postman_collection.json",
      "bruno.json",
      "requests/users.bru",
      "src/app.ts",
    ]);

    expect(overview.apiArtifacts).toContainEqual({
      kind: "openapi",
      path: "openapi.yaml",
    });
    expect(overview.apiArtifacts).toContainEqual({
      kind: "openapi",
      path: "docs/swagger.json",
    });
    expect(overview.apiArtifacts).toContainEqual({
      kind: "postman",
      path: "acme.postman_collection.json",
    });
    expect(overview.apiArtifacts).toContainEqual({
      kind: "bruno",
      path: "requests/users.bru",
    });
    expect(overview.apiArtifacts).toHaveLength(6);
  });

  it("says nothing when the repository has no API artifacts", () => {
    expect(describeRepository(["src/app.ts"]).apiArtifacts).toBeUndefined();
  });

  it("recognises more languages and name-based files", () => {
    const overview = describeRepository([
      "src/main.fs",
      "src/App.razor",
      "scripts/deploy.ps1",
      "native/mod.zig",
      "contracts/Token.sol",
      "Dockerfile",
      "Makefile",
      "CMakeLists.txt",
      "app/main.gd",
      "shaders/test.wgsl",
      "ui/Button.vue",
      "templates/page.hbs",
    ]);
    const names = overview.languages.map((language) => language.name);
    for (const language of [
      "F#",
      "C#",
      "PowerShell",
      "Zig",
      "Solidity",
      "Dockerfile",
      "Makefile",
      "CMake",
      "GDScript",
      "WGSL",
      "Vue",
      "Handlebars",
    ]) {
      expect(names).toContain(language);
    }
  });
});

describe("packageFacts", () => {
  it("reads the name, version and engine range", () => {
    const facts = packageFacts(
      JSON.stringify({
        name: "acme-api",
        version: "1.4.2",
        packageManager: "pnpm@9.1.0",
        engines: { node: ">=20.11" },
      }),
    );
    expect(facts.packageName).toBe("acme-api");
    expect(facts.packageVersion).toBe("1.4.2");
    expect(facts.packageManager).toBe("pnpm");
    expect(facts.runtime).toBe("node");
    expect(facts.runtimeVersion).toBe("20.11");
  });

  it("says nothing when the file is not a package manifest", () => {
    expect(packageFacts("not json")).toEqual({});
  });
});

describe("classifyTree", () => {
  it("finds a test in an ancestor test directory, not just next to the source", () => {
    const { missing, testsBySource } = classifyTree([
      "packages/api/src/user.ts",
      "packages/api/tests/user.test.ts",
    ]);
    expect(missing).toHaveLength(0);
    expect(testsBySource.get("packages/api/src/user.ts")).toEqual([
      "packages/api/tests/user.test.ts",
    ]);
  });

  it("marks a missing test with a kind and a language", () => {
    const { missing } = classifyTree(["src/untested.ts"]);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      path: "src/untested.ts",
      kind: "missing",
      language: "TypeScript",
    });
  });

  it("reports a language EdgeSpec cannot generate for instead of hiding it", () => {
    const { missing, unsupported } = classifyTree([
      "src/app.ts",
      "src/app.test.ts",
      "scripts/tool.py",
      "cmd/server.go",
    ]);
    expect(missing).toHaveLength(0);
    expect(unsupported.map((gap) => gap.path)).toEqual(["cmd/server.go", "scripts/tool.py"]);
    expect(unsupported[0]).toMatchObject({
      kind: "unsupported",
      language: "Go",
    });
  });

  it("keeps a test infra file out of source discovery", () => {
    const { missing } = classifyTree(["test/mock.ts", "src/__tests__/helper.ts"]);
    expect(missing).toHaveLength(0);
  });
});

describe("describeRepository languages", () => {
  it("counts the languages a repository is written in", () => {
    const overview = describeRepository([
      "src/app.ts",
      "src/main.go",
      "src/lib.rs",
      "src/Main.java",
      "src/model.rb",
      "src/api.php",
      "src/tool.cs",
      "src/lib.c",
      "src/main.cpp",
      "src/query.sql",
      "src/deploy.sh",
      "web/index.html",
      "web/app.css",
    ]);
    const names = overview.languages.map((language) => language.name);
    for (const language of [
      "TypeScript",
      "Go",
      "Rust",
      "Java",
      "Ruby",
      "PHP",
      "C#",
      "C",
      "C++",
      "SQL",
      "Shell",
      "HTML",
      "CSS",
    ]) {
      expect(names).toContain(language);
    }
  });
});
