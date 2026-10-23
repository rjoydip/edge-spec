import { describe, expect, it } from "bun:test";
import {
  classifyCommand,
  detectChecks,
  detectPackageManager,
  detectStyle,
  workflowCommands,
} from "../src/core/ci";

const manifest = (scripts: Record<string, string>, extra: Record<string, string> = {}) =>
  JSON.stringify({ name: "acme", scripts, devDependencies: extra });

describe("detectChecks", () => {
  it("reads the checks out of the package manifest", () => {
    const checks = detectChecks({
      paths: ["package.json", "bun.lock", "src/a.ts"],
      packageJson: manifest({
        lint: "biome check .",
        format: "prettier --write .",
        build: "vite build",
        test: "bun test",
      }),
    });

    expect(checks.checks.map((check) => check.kind).sort()).toEqual([
      "build",
      "format",
      "lint",
      "test",
    ]);
    expect(checks.checks.find((check) => check.kind === "lint")?.command).toBe("biome check .");
    expect(checks.packageManager).toBe("bun");
  });

  it("reads the checks out of a GitHub Actions workflow", () => {
    const workflow = [
      "name: CI",
      "on: [push]",
      "jobs:",
      "  test:",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - run: bun install --frozen-lockfile",
      "      - run: bun run lint",
      "      - run: |",
      "        bun test",
      "        bun run build",
    ].join("\n");

    const checks = detectChecks({
      paths: [".github/workflows/ci.yml", "package.json"],
      workflows: { ".github/workflows/ci.yml": workflow },
    });

    const kinds = checks.checks.map((check) => check.kind);
    expect(kinds).toContain("lint");
    expect(kinds).toContain("test");
    expect(kinds).toContain("build");
    // An install step is not a check.
    expect(checks.checks.some((check) => check.command.includes("install"))).toBe(false);
  });

  it("finds the formatter and the style rules", () => {
    const checks = detectChecks({
      paths: ["package.json", ".prettierrc", "src/a.ts"],
      packageJson: manifest({}, { prettier: "^3.0.0" }),
      files: {
        ".prettierrc": JSON.stringify({
          printWidth: 100,
          semi: false,
          singleQuote: true,
          tabWidth: 2,
          trailingComma: "all",
        }),
      },
    });

    expect(checks.formatter?.name).toBe("prettier");
    expect(checks.formatter?.command).toContain("prettier --write");
    expect(checks.style.join(" ")).toContain("2 space indentation");
    expect(checks.style.join(" ")).toContain("no semicolons");
    expect(checks.style.join(" ")).toContain("single quotes");
  });

  it("uses the format script when the repository has one", () => {
    const checks = detectChecks({
      paths: ["package.json"],
      packageJson: manifest({ format: "biome format --write ." }),
    });
    expect(checks.formatter).toEqual({ name: "format", command: "biome format --write ." });
  });

  it("says nothing when the repository says nothing", () => {
    const checks = detectChecks({ paths: ["src/a.ts"], packageJson: manifest({}) });
    expect(checks.checks).toEqual([]);
    expect(checks.formatter).toBeUndefined();
  });
});

describe("workflowCommands", () => {
  it("reads single lines and blocks", () => {
    const workflow = ["      - run: bun run lint", "      - run: |", "        bun test"].join("\n");
    expect(workflowCommands(workflow)).toEqual(["bun run lint", "bun test"]);
  });
});

describe("classifyCommand", () => {
  it("tells the checks apart from the rest", () => {
    expect(classifyCommand("bun run lint")).toBe("lint");
    expect(classifyCommand("bunx prettier --check .")).toBe("format");
    expect(classifyCommand("bunx tsc --noEmit")).toBe("typecheck");
    expect(classifyCommand("bun run build")).toBe("build");
    expect(classifyCommand("bun test")).toBe("test");
    expect(classifyCommand("bun install")).toBeUndefined();
    expect(classifyCommand("echo hello")).toBeUndefined();
  });
});

describe("detectPackageManager", () => {
  it("reads the lockfile", () => {
    expect(detectPackageManager(["bun.lock"])).toBe("bun");
    expect(detectPackageManager(["pnpm-lock.yaml"])).toBe("pnpm");
    expect(detectPackageManager(["yarn.lock"])).toBe("yarn");
    expect(detectPackageManager(["package-lock.json"])).toBe("npm");
  });
});

describe("detectStyle", () => {
  it("reads the editor config", () => {
    const rules = detectStyle({ ".editorconfig": "indent_style = tab\nindent_size = 4\n" });
    expect(rules.join(" ")).toContain("tab");
  });
});
