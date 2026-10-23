/**
 * The checks a repository runs in CI: lint, format, typecheck, build, test.
 * EdgeSpec reads them out of the repository so a generated test is measured
 * against the same commands the pipeline will run.
 */
import type { CheckKind } from "./types";

export interface RepositoryCheck {
  kind: CheckKind;
  /** A readable name, e.g. "lint" or "biome check". */
  name: string;
  /** The command to run, e.g. `bun run lint`. */
  command: string;
  source: "script" | "workflow";
}

export interface RepositoryChecks {
  checks: RepositoryCheck[];
  /** The formatter, when the repository has one. */
  formatter?: { name: string; command: string };
  /** The style rules the model should write to. */
  style: string[];
  packageManager: string;
}

/** Script names that map to a kind. The order matters: the first match wins. */
const SCRIPT_KINDS: Record<string, CheckKind> = {
  format: "format",
  "format:check": "format",
  "format:fix": "format",
  prettier: "format",
  biome: "format",
  "biome:check": "format",
  lint: "lint",
  "lint:check": "lint",
  eslint: "lint",
  typecheck: "typecheck",
  "type-check": "typecheck",
  tsc: "typecheck",
  build: "build",
  test: "test",
  "test:unit": "test",
  "test:ci": "test",
  check: "test",
  ci: "test",
};

/** The files EdgeSpec reads to learn the rules. They are small by design. */
export const SUPPORT_FILES = [
  "package.json",
  "tsconfig.json",
  "biome.json",
  "biome.jsonc",
  "dprint.json",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.toml",
  "prettier.config.js",
  ".editorconfig",
  "eslint.config.js",
  "eslint.config.mjs",
  ".eslintrc.json",
];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/** The package manager the lockfile implies. */
export function detectPackageManager(paths: readonly string[]): string {
  const names = new Set(paths.map((path) => path.slice(path.lastIndexOf("/") + 1)));
  if (names.has("bun.lock") || names.has("bun.lockb")) return "bun";
  if (names.has("pnpm-lock.yaml")) return "pnpm";
  if (names.has("yarn.lock")) return "yarn";
  if (names.has("package-lock.json")) return "npm";
  if (names.has("deno.lock")) return "deno";
  return "npm";
}

/** The `run` steps of a workflow file. */
export function workflowCommands(content: string): string[] {
  const commands: string[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^\s*(?:-\s*)?run:\s*(.+)$/.exec(line);
    if (!match) continue;
    let command = (match[1] ?? "").trim();
    if (command === "|" || command === ">" || command === "|-" || command === ">-") {
      // A block: the indented lines that follow.
      const indent = line.length - line.trimStart().length;
      const block: string[] = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        const text = lines[next] ?? "";
        if (text.trim() === "") {
          block.push("");
          continue;
        }
        if (text.length - text.trimStart().length <= indent) break;
        block.push(text.trim());
      }
      command = block.join("\n").trim();
      index += block.length;
    }
    if (command) commands.push(command);
  }
  return commands;
}

/** Which kind of check a command is, or nothing when it is not a check. */
export function classifyCommand(command: string): CheckKind | undefined {
  const value = command.toLowerCase();
  if (/\b(install|ci|checkout|setup-node|setup-bun|cache|upload|download)\b/.test(value)) {
    return undefined;
  }
  if (/\b(prettier|dprint|biome\s+format|format)\b/.test(value)) return "format";
  if (/\b(eslint|oxlint|biome\s+lint|lint)\b/.test(value)) return "lint";
  if (/\b(tsc|typecheck|type-check|tsc\b)\b/.test(value)) return "typecheck";
  if (/\b(build)\b/.test(value)) return "build";
  if (/\b(test|vitest|jest|playwright|cypress)\b/.test(value)) return "test";
  return undefined;
}

/** The style rules the model should write to, read from the config files. */
export function detectStyle(files: Record<string, string>): string[] {
  const rules: string[] = [];
  const prettier = files[".prettierrc"] ?? files[".prettierrc.json"] ?? "";
  if (prettier) {
    try {
      const config = asRecord(JSON.parse(prettier));
      const width = text(config.printWidth);
      const semi = config.semi;
      const single = config.singleQuote;
      const trailing = text(config.trailingComma);
      const tab = text(config.tabWidth);
      const parts: string[] = [];
      if (tab) parts.push(`${tab} space indentation`);
      if (width) parts.push(`a print width of ${width}`);
      if (semi === false) parts.push("no semicolons");
      else parts.push("semicolons");
      if (single === true) parts.push("single quotes");
      else parts.push("double quotes");
      if (trailing) parts.push(`${trailing} trailing commas`);
      rules.push(`The repository formats with ${parts.join(", ")}.`);
    } catch {
      // A config we cannot read is not a rule we can state.
    }
  }

  const editor = files[".editorconfig"] ?? "";
  if (editor) {
    const indent = /indent_size\s*=\s*(\d+)/.exec(editor)?.[1];
    const size = /indent_style\s*=\s*(\w+)/.exec(editor)?.[1];
    if (indent || size) {
      rules.push(`The editor config asks for ${size ?? "spaces"}${indent ? ` of ${indent}` : ""}.`);
    }
  }

  const biome = files["biome.json"] ?? files["biome.jsonc"] ?? "";
  if (biome) {
    rules.push("The repository uses Biome, so it enforces its own formatting and lint rules.");
  }
  return rules;
}

/**
 * The checks a repository runs, and the formatter it uses. Everything is read
 * from the repository: the package manifest, the config files and the GitHub
 * Actions workflows.
 */
export function detectChecks(input: {
  paths: readonly string[];
  packageJson?: string;
  /** Workflow file contents, keyed by path. */
  workflows?: Record<string, string>;
  /** The config file contents, keyed by path. */
  files?: Record<string, string>;
}): RepositoryChecks {
  const packageManager = detectPackageManager(input.paths);
  const files = input.files ?? {};
  const scripts: Record<string, string> = {};
  let devDependencies: Record<string, unknown> = {};

  if (input.packageJson) {
    try {
      const manifest = asRecord(JSON.parse(input.packageJson));
      const raw = asRecord(manifest.scripts);
      for (const [name, value] of Object.entries(raw)) scripts[name] = text(value);
      devDependencies = asRecord(manifest.devDependencies);
    } catch {
      // A manifest we cannot read simply tells us nothing.
    }
  }

  const checks: RepositoryCheck[] = [];
  const seen = new Set<string>();

  const add = (check: RepositoryCheck) => {
    const key = `${check.kind}:${check.command}`;
    if (seen.has(key)) return;
    seen.add(key);
    checks.push(check);
  };

  // The scripts of the manifest come first: they are what a developer runs.
  for (const [name, command] of Object.entries(scripts)) {
    const kind = SCRIPT_KINDS[name];
    if (!kind) continue;
    add({ kind, name, command, source: "script" });
  }

  // Then the workflows: what CI actually runs. A step can hold several
  // commands, and each one is a check of its own.
  for (const content of Object.values(input.workflows ?? {})) {
    for (const step of workflowCommands(content)) {
      for (const command of step
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)) {
        const kind = classifyCommand(command);
        if (!kind) continue;
        add({ kind, name: kind, command, source: "workflow" });
      }
    }
  }

  // The formatter: a format script, or the tool the repository configures.
  let formatter: RepositoryChecks["formatter"];
  const formatScript = scripts.format ?? scripts["format:fix"] ?? scripts.prettier;
  if (formatScript) {
    formatter = { name: "format", command: formatScript };
  } else {
    const names = new Set(input.paths.map((path) => path.slice(path.lastIndexOf("/") + 1)));
    const runner =
      packageManager === "bun" ? "bunx" : packageManager === "pnpm" ? "pnpm exec" : "npx";
    if (names.has("biome.json") || names.has("biome.jsonc")) {
      formatter = { name: "biome", command: `${runner} biome format --write` };
    } else if (names.has("dprint.json") || names.has("dprint.jsonc")) {
      formatter = { name: "dprint", command: `${runner} dprint fmt` };
    } else if (
      names.has(".prettierrc") ||
      names.has(".prettierrc.json") ||
      names.has(".prettierrc.toml") ||
      names.has("prettier.config.js") ||
      "prettier" in devDependencies
    ) {
      formatter = { name: "prettier", command: `${runner} prettier --write` };
    }
  }

  return {
    checks,
    ...(formatter ? { formatter } : {}),
    style: detectStyle(files),
    packageManager,
  };
}
