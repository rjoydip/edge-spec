import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readLocalFile, scanLocalProject } from "../vite.local";

let root: string | undefined;
let outside: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  if (outside) rmSync(outside, { force: true });
  root = undefined;
  outside = undefined;
});

function fixture(): string {
  root = mkdtempSync(join(tmpdir(), "edgespec-local-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  writeFileSync(join(root, "src", "covered.ts"), "export const covered = true;\n");
  writeFileSync(
    join(root, "src", "covered.test.ts"),
    'import { expect, test } from "bun:test";\ntest("covered", () => expect(true).toBe(true));\n',
  );
  writeFileSync(
    join(root, "src", "missing.ts"),
    "export function add(a: number, b: number) {\n  return a + b;\n}\n",
  );
  return root;
}

describe("local project API", () => {
  test("finds only source files without a sibling test", () => {
    const project = fixture();
    const result = scanLocalProject(project);

    expect(result.repo).toBe(project);
    expect(result.ref).toBe("local");
    expect(result.gaps.map((gap) => gap.path)).toEqual(["src/missing.ts"]);
    expect(result.gaps[0]?.exports).toContain("add");
    expect(result.overview?.packageName).toBe("fixture");
  });

  test("reads files inside the project and refuses escape paths", () => {
    const project = fixture();
    outside = join(dirname(project), "edgespec-outside.ts");
    writeFileSync(outside, "export const outside = true;\n");

    expect(readLocalFile(project, "src/missing.ts")).toContain("function add");
    expect(() => readLocalFile(project, "../edgespec-outside.ts")).toThrow("outside");
  });
});
