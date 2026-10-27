import { describe, expect, it } from "bun:test";
import { buildGraph, impactedTests, importsOf, resolveImport } from "../src/graph";

const FILES = {
  "src/c.ts": "export const c = 1;",
  "src/b.ts": 'import { c } from "./c";\nexport const b = c;',
  "src/a.ts": 'import { b } from "./b";\nexport const a = b;',
  "src/a.test.ts":
    'import { a } from "./a";\nimport { expect, it } from "bun:test";\nit("a", () => expect(a).toBe(1));',
  "src/unrelated.ts": 'import { z } from "zod";\nexport const z = 1;',
  "src/unrelated.test.ts": 'import { z } from "./unrelated";\nit("z", () => expect(z).toBe(1));',
  "lib/index.ts": "export const lib = 1;",
  "src/uses-index.ts": 'import { lib } from "../lib";\nexport const use = lib;',
};

describe("importsOf", () => {
  it("reads static, side-effect, require and dynamic imports once", () => {
    expect(
      importsOf(
        'import a from "./a"; import "./side"; export { b } from "./b"; const c = require("./c"); import("./d");',
      ),
    ).toEqual(["./a", "./side", "./b", "./c", "./d"]);
  });
});

describe("resolveImport", () => {
  const present = new Set(Object.keys(FILES));

  it("resolves extensions and index files", () => {
    expect(resolveImport("src/a.ts", "./b", present)).toBe("src/b.ts");
    expect(resolveImport("src/uses-index.ts", "../lib", present)).toBe("lib/index.ts");
  });

  it("ignores package specifiers and missing relative files", () => {
    expect(resolveImport("src/a.ts", "zod", present)).toBeUndefined();
    expect(resolveImport("src/a.ts", "./missing", present)).toBeUndefined();
  });

  it("maps a .js specifier to the .ts source", () => {
    expect(resolveImport("src/a.ts", "./b.js", present)).toBe("src/b.ts");
  });
});

describe("impactedTests", () => {
  const graph = buildGraph(FILES);

  it("selects direct and transitive test dependents with a reason chain", () => {
    expect(impactedTests(["src/c.ts"], graph)).toEqual([
      {
        test: "src/a.test.ts",
        via: ["src/c.ts", "src/b.ts", "src/a.ts", "src/a.test.ts"],
      },
    ]);
  });

  it("includes a sibling test for the changed source", () => {
    const tests = impactedTests(["src/unrelated.ts"], graph);
    expect(tests.map((item) => item.test)).toEqual(["src/unrelated.test.ts"]);
    expect(tests[0]?.via).toEqual(["src/unrelated.ts", "src/unrelated.test.ts"]);
  });

  it("includes a changed test file itself", () => {
    expect(impactedTests(["src/a.test.ts"], graph).map((item) => item.test)).toEqual([
      "src/a.test.ts",
    ]);
  });

  it("does not select unrelated tests", () => {
    expect(impactedTests(["src/c.ts"], graph).some((item) => item.test.includes("unrelated"))).toBe(
      false,
    );
  });
});
