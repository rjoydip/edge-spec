import { parseArgs, type ParseArgsConfig } from "node:util";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type ParsedArgs =
  | {
      command: "scan";
      repo: string;
      url?: string;
      ref?: string;
      folder?: string;
      limit?: number;
      json: boolean;
    }
  | {
      command: "generate";
      repo: string;
      path: string;
      url?: string;
      ref?: string;
      provider?: string;
      model?: string;
      accountId?: string;
      coverageTarget?: number;
      strictTypes?: boolean;
      maxRetries?: number;
      maxAiRetries?: number;
      sandboxUrl?: string;
      out?: string;
      pr: boolean;
      json: boolean;
    }
  | {
      command: "run";
      repo: string;
      url?: string;
      ref?: string;
      provider?: string;
      model?: string;
      accountId?: string;
      coverageTarget?: number;
      strictTypes?: boolean;
      maxRetries?: number;
      maxAiRetries?: number;
      maxFiles?: number;
      sandboxUrl?: string;
      pr: boolean;
      json: boolean;
    }
  | {
      command: "watch";
      path: string;
      url?: string;
      provider?: string;
      model?: string;
      accountId?: string;
      sandboxUrl?: string;
      write: boolean;
      json: boolean;
    }
  | {
      command: "catalog";
      url?: string;
      json: boolean;
    }
  | { command: "help"; topic?: string }
  | { command: "version" };

const common = {
  url: { type: "string" as const },
  provider: { type: "string" as const },
  model: { type: "string" as const },
  "account-id": { type: "string" as const },
  json: { type: "boolean" as const, default: false },
  help: { type: "boolean" as const, short: "h", default: false },
};

const runOptions = {
  ...common,
  ref: { type: "string" as const },
  "coverage-target": { type: "string" as const },
  "max-retries": { type: "string" as const },
  "max-ai-retries": { type: "string" as const },
  "max-files": { type: "string" as const },
  "strict-types": { type: "boolean" as const, default: true },
  "no-strict-types": { type: "boolean" as const, default: false },
  "sandbox-url": { type: "string" as const },
  pr: { type: "boolean" as const, default: false },
};

const generateOptions = {
  ...runOptions,
  out: { type: "string" as const },
};

function positiveInt(
  value: string | boolean | undefined,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new UsageError(`${name} must be a number between ${min} and ${max}.`);
  }
  return Math.round(number);
}

function text(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strictOf(values: Record<string, string | boolean | undefined>): boolean {
  return values["no-strict-types"] ? false : values["strict-types"] !== false;
}

function parse(
  args: string[],
  options: ParseArgsConfig["options"],
): {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
} {
  const parsed = parseArgs({
    args,
    options,
    allowPositionals: true,
    strict: true,
  });
  return {
    values: parsed.values as Record<string, string | boolean | undefined>,
    positionals: parsed.positionals,
  };
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) return { command: "help" };
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") return { command: "help" };
  if (command === "--version" || command === "-v") return { command: "version" };

  if (command === "scan") {
    const { values, positionals } = parse(rest, {
      ...common,
      ref: { type: "string" },
      folder: { type: "string" },
      limit: { type: "string" },
    });
    if (values.help) return { command: "help", topic: "scan" };
    if (positionals.length !== 1) throw new UsageError("scan needs exactly one repository.");
    const limit = positiveInt(values.limit, "--limit", 1, 100);
    return {
      command: "scan",
      repo: positionals[0]!,
      ...(text(values.url) ? { url: text(values.url) } : {}),
      ...(text(values.ref) ? { ref: text(values.ref) } : {}),
      ...(text(values.folder) ? { folder: text(values.folder) } : {}),
      ...(limit !== undefined ? { limit } : {}),
      json: values.json === true,
    };
  }

  if (command === "generate") {
    const { values, positionals } = parse(rest, generateOptions);
    if (values.help) return { command: "help", topic: "generate" };
    if (positionals.length !== 2) {
      throw new UsageError("generate needs a repository and a source path.");
    }
    const coverageTarget = positiveInt(values["coverage-target"], "--coverage-target", 0, 100);
    const maxRetries = positiveInt(values["max-retries"], "--max-retries", 0, 5);
    const maxAiRetries = positiveInt(values["max-ai-retries"], "--max-ai-retries", 0, 5);
    return {
      command: "generate",
      repo: positionals[0]!,
      path: positionals[1]!,
      ...(text(values.url) ? { url: text(values.url) } : {}),
      ...(text(values.ref) ? { ref: text(values.ref) } : {}),
      ...(text(values.provider) ? { provider: text(values.provider) } : {}),
      ...(text(values.model) ? { model: text(values.model) } : {}),
      ...(text(values["account-id"]) ? { accountId: text(values["account-id"]) } : {}),
      ...(coverageTarget !== undefined ? { coverageTarget } : {}),
      strictTypes: strictOf(values),
      ...(maxRetries !== undefined ? { maxRetries } : {}),
      ...(maxAiRetries !== undefined ? { maxAiRetries } : {}),
      ...(text(values["sandbox-url"]) ? { sandboxUrl: text(values["sandbox-url"]) } : {}),
      ...(text(values.out) ? { out: text(values.out) } : {}),
      pr: values.pr === true,
      json: values.json === true,
    };
  }

  if (command === "run") {
    const { values, positionals } = parse(rest, runOptions);
    if (values.help) return { command: "help", topic: "run" };
    if (positionals.length !== 1) throw new UsageError("run needs exactly one repository.");
    const coverageTarget = positiveInt(values["coverage-target"], "--coverage-target", 0, 100);
    const maxRetries = positiveInt(values["max-retries"], "--max-retries", 0, 5);
    const maxAiRetries = positiveInt(values["max-ai-retries"], "--max-ai-retries", 0, 5);
    const maxFiles = positiveInt(values["max-files"], "--max-files", 1, 50);
    return {
      command: "run",
      repo: positionals[0]!,
      ...(text(values.url) ? { url: text(values.url) } : {}),
      ...(text(values.ref) ? { ref: text(values.ref) } : {}),
      ...(text(values.provider) ? { provider: text(values.provider) } : {}),
      ...(text(values.model) ? { model: text(values.model) } : {}),
      ...(text(values["account-id"]) ? { accountId: text(values["account-id"]) } : {}),
      ...(coverageTarget !== undefined ? { coverageTarget } : {}),
      strictTypes: strictOf(values),
      ...(maxRetries !== undefined ? { maxRetries } : {}),
      ...(maxAiRetries !== undefined ? { maxAiRetries } : {}),
      ...(maxFiles !== undefined ? { maxFiles } : {}),
      ...(text(values["sandbox-url"]) ? { sandboxUrl: text(values["sandbox-url"]) } : {}),
      pr: values.pr === true,
      json: values.json === true,
    };
  }

  if (command === "watch") {
    const { values, positionals } = parse(rest, {
      ...common,
      "sandbox-url": { type: "string" as const },
      "strict-types": { type: "boolean" as const, default: true },
      "no-strict-types": { type: "boolean" as const, default: false },
      write: { type: "boolean" as const, default: false },
    });
    if (values.help) return { command: "help", topic: "watch" };
    if (positionals.length !== 1) throw new UsageError("watch needs one workspace directory.");
    return {
      command: "watch",
      path: positionals[0]!,
      ...(text(values.url) ? { url: text(values.url) } : {}),
      ...(text(values.provider) ? { provider: text(values.provider) } : {}),
      ...(text(values.model) ? { model: text(values.model) } : {}),
      ...(text(values["account-id"]) ? { accountId: text(values["account-id"]) } : {}),
      ...(text(values["sandbox-url"]) ? { sandboxUrl: text(values["sandbox-url"]) } : {}),
      write: values.write === true,
      json: values.json === true,
    };
  }

  if (command === "catalog") {
    const { values, positionals } = parse(rest, common);
    if (values.help) return { command: "help", topic: "catalog" };
    if (positionals.length > 0) throw new UsageError("catalog takes no positional arguments.");
    return {
      command: "catalog",
      ...(text(values.url) ? { url: text(values.url) } : {}),
      json: values.json === true,
    };
  }

  if (command === "help") return { command: "help", ...(rest[0] ? { topic: rest[0] } : {}) };
  throw new UsageError(`Unknown command: ${command}`);
}

export const helpText = `EdgeSpec CLI

Usage:
  edge-spec scan <owner/name> [options]
  edge-spec generate <owner/name> <path> [options]
  edge-spec run <owner/name> [options]
  edge-spec watch <directory> [options]
  edge-spec catalog [options]

Options:
  --url <url>                EdgeSpec Worker URL (default: EDGESPEC_URL or localhost:8787)
  --ref <ref>                Branch or tag (default: main)
  --provider <id>            AI provider id (default: EDGESPEC_AI_PROVIDER)
  --model <id>               Model id (default: EDGESPEC_AI_MODEL)
  --account-id <id>          Cloudflare account id for Workers AI BYOK
  --coverage-target <n>      Target branch coverage, 0-100
  --max-retries <n>          Self-correction attempts, 0-5
  --max-ai-retries <n>       AI call retries, 0-5
  --max-files <n>            Files in one run, 1-50
  --no-strict-types          Disable strict TypeScript checks
  --sandbox-url <url>        Sandbox URL
  --folder <path>            Prioritize this folder when scanning
  --limit <n>                Limit scan results, 1-100
  --out <file>               Write generated code to a file
  --write                    Watch mode: apply generated tests without asking
  --pr                       Open a pull request for passing tests
  --json                     Print machine-readable JSON
  -h, --help                 Show this help
  -v, --version              Show the version

Secrets are read from the environment, never from flags:
  GH_TOKEN                 GitHub token (GITHUB_TOKEN / EDGESPEC_GITHUB_TOKEN are aliases)
  EDGESPEC_AI_KEY              Provider key; provider-specific keys also work
  EDGESPEC_AI_BASE_URL         Base URL for the private provider
  EDGESPEC_SANDBOX_URL         Sandbox URL
  EDGESPEC_SANDBOX_KEY         Test runner key
  EDGESPEC_DEPLOYMENT_AI=1     Use the deployment's Workers AI binding
`;
