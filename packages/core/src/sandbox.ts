/**
 * The sandbox contract. v1 is `{files, command}`; v2 adds a repo clone, setup
 * commands, a booted server, env and coverage. The body is only upgraded when
 * the caller uses a v2 feature, so existing runners keep working.
 */
import { parseLcov, type CoverageReport } from "./coverage";
import { HttpError } from "./types";

export interface SandboxServer {
  command: string;
  /** Polled until it answers before the test command runs. */
  readyUrl?: string;
  timeoutMs?: number;
}

/**
 * The drivers the runner can use. `auto` lets it pick, `custom` is any v2
 * runner. Hosted providers are runner drivers too, so they are listed here.
 */
export type SandboxProviderId =
  "auto" | "bwrap" | "docker" | "podman" | "e2b" | "vercel" | "daytona" | "custom";

export const SANDBOX_PROVIDERS: ReadonlyArray<{ id: SandboxProviderId; label: string }> = [
  { id: "auto", label: "Auto (whatever the runner uses)" },
  { id: "docker", label: "Docker Desktop" },
  { id: "podman", label: "Podman" },
  { id: "bwrap", label: "bwrap namespace" },
  { id: "e2b", label: "E2B" },
  { id: "vercel", label: "Vercel Sandbox" },
  { id: "daytona", label: "Daytona" },
  { id: "custom", label: "Custom runner" },
];

/** Drivers that imply a runner on this machine, which only a local dashboard reaches. */
const LOCAL_ONLY_SANDBOX_PROVIDERS: ReadonlySet<SandboxProviderId> = new Set([
  "docker",
  "podman",
  "bwrap",
]);

/**
 * Which drivers the picker offers. A deployed Worker cannot reach a local
 * daemon, so only a locally-served dashboard lists the local drivers. The
 * runner still accepts every id: this only narrows the UI.
 */
export function sandboxProvidersFor(
  scope: "local" | "deployed",
): ReadonlyArray<{ id: SandboxProviderId; label: string }> {
  return scope === "local"
    ? SANDBOX_PROVIDERS
    : SANDBOX_PROVIDERS.filter((entry) => !LOCAL_ONLY_SANDBOX_PROVIDERS.has(entry.id));
}

export interface SandboxConfig {
  url?: string;
  apiKey?: string;
  /** Asserts which driver the runner must use; `auto` asserts nothing. */
  provider?: SandboxProviderId;
  /** Commands run before the test command. A failure is an environment error. */
  setup?: string[];
  env?: Record<string, string>;
  server?: SandboxServer;
  /** Client and runner timeout. Clamped to 10 s – 10 min. */
  timeoutMs?: number;
  /** How many sandbox runs the client may have in flight. Clamped 1–4. */
  concurrency?: number;
  coverage?: boolean;
  /** Relative directory inside the cloned repo or the written files. */
  cwd?: string;
  /** Explicit opt-in before a GitHub token is sent to a BYO runner. */
  allowRepoToken?: boolean;
  /** Force a v2 body even when no other v2 field is set. */
  v2?: boolean;
}

export interface SandboxRepo {
  url: string;
  ref?: string;
  /** Only sent when `allowRepoToken` is set. */
  token?: string;
}

/**
 * The repository a v2 runner clones. Only v2 configurations get one: a plain
 * `{files, command}` runner keeps the cheap path, and the GitHub token travels
 * only after the caller explicitly opted in.
 */
export function sandboxRepo(input: {
  repo: string;
  ref: string;
  sandbox?: SandboxConfig;
  token?: string;
}): SandboxRepo | undefined {
  const sandbox = input.sandbox;
  if (!sandbox) return undefined;
  const v2 = Boolean(
    sandbox.v2 ||
    sandbox.setup?.length ||
    sandbox.server ||
    sandbox.cwd !== undefined ||
    sandbox.coverage,
  );
  if (!v2) return undefined;
  const token = sandbox.allowRepoToken ? input.token?.trim() : undefined;
  return {
    url: `https://github.com/${input.repo}.git`,
    ref: input.ref,
    ...(token ? { token } : {}),
  };
}

export interface SandboxRequest {
  files?: Record<string, string>;
  repo?: SandboxRepo;
  cwd?: string;
  setup?: string[];
  env?: Record<string, string>;
  server?: SandboxServer;
  command: string;
  coverage?: { format: "lcov" };
  timeoutMs?: number;
}

export interface SandboxReply {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  /** Files after the command ran, so a formatter can return its output. */
  files?: Record<string, string>;
  /** Coverage and test reports the runner produced. */
  artifacts?: Record<string, string>;
  coverage?: CoverageReport;
  timedOut?: boolean;
  /** Set when clone/setup/server failed before the test command ran. */
  environmentError?: string;
}

export interface SandboxRun {
  ok: boolean;
  exitCode: number;
  output: string;
  files: Record<string, string>;
  artifacts: Record<string, string>;
  coverage?: CoverageReport;
  timedOut?: boolean;
  /** Set when the runner could not be reached. */
  unreachable?: string;
  /** Set when the environment failed before the test command ran. */
  environmentError?: "setup" | "server" | "unreachable" | "timeout";
}

export interface SandboxHealth {
  ok: boolean;
  version?: string;
  capabilities?: string[];
  /** The driver the runner actually used. */
  provider?: string;
  isolation?: "namespace" | "container" | "vm" | "none";
  error?: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const CONFIG_FIELDS = new Set([
  "provider",
  "setup",
  "env",
  "server",
  "timeoutMs",
  "concurrency",
  "coverage",
  "cwd",
  "allowRepoToken",
  "v2",
]);

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `Sandbox config field "${field}" must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new HttpError(400, `Sandbox config field "${field}" is longer than ${max} characters.`);
  }
  return trimmed;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `Sandbox config field "${field}" must be true or false.`);
  }
  return value;
}

function clampNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, `Sandbox config field "${field}" must be a number.`);
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function relativeCwd(value: unknown): string {
  const cwd = text(value, "cwd", 240).replace(/\\/g, "/");
  if (cwd.startsWith("/") || /^[A-Za-z]:/.test(cwd) || cwd.split("/").includes("..")) {
    throw new HttpError(400, 'Sandbox config field "cwd" must stay inside the sandbox workdir.');
  }
  return cwd.replace(/^\.\//, "");
}

/**
 * Validates the non-secret part of a BYO sandbox config. URL and key are kept
 * out of this object on purpose: they travel in their own headers.
 */
export function parseSandboxConfig(input: unknown): SandboxConfig {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Sandbox config must be a JSON object.");
  }
  const record = asRecord(input);
  for (const key of Object.keys(record)) {
    if (!CONFIG_FIELDS.has(key)) {
      throw new HttpError(
        400,
        `Unknown sandbox config field "${key}". URL and key travel in x-sandbox-url / x-sandbox-key.`,
      );
    }
  }

  const config: SandboxConfig = {};

  if (record.provider !== undefined) {
    const provider = text(record.provider, "provider", 40);
    if (!SANDBOX_PROVIDERS.some((entry) => entry.id === provider)) {
      throw new HttpError(400, `Unknown sandbox provider "${provider}".`);
    }
    config.provider = provider as SandboxProviderId;
  }

  if (record.setup !== undefined) {
    if (!Array.isArray(record.setup) || record.setup.length > 20) {
      throw new HttpError(400, "Sandbox config setup must be an array of at most 20 commands.");
    }
    config.setup = record.setup.map((command, index) => text(command, `setup[${index}]`, 1000));
  }

  if (record.env !== undefined) {
    const env = asRecord(record.env);
    const entries = Object.entries(env);
    if (entries.length > 50) {
      throw new HttpError(400, "Sandbox config env may have at most 50 entries.");
    }
    const parsed: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (!ENV_KEY.test(key)) {
        throw new HttpError(400, `Sandbox env key "${key}" is not a valid variable name.`);
      }
      if (typeof value !== "string" || value.length > 4000) {
        throw new HttpError(
          400,
          `Sandbox env value for "${key}" must be a string under 4000 characters.`,
        );
      }
      parsed[key] = value;
    }
    config.env = parsed;
  }

  if (record.server !== undefined) {
    const server = asRecord(record.server);
    for (const key of Object.keys(server)) {
      if (key !== "command" && key !== "readyUrl" && key !== "timeoutMs") {
        throw new HttpError(400, `Unknown sandbox server field "${key}".`);
      }
    }
    const command = text(server.command, "server.command", 1000);
    let readyUrl: string | undefined;
    if (server.readyUrl !== undefined) {
      const raw = text(server.readyUrl, "server.readyUrl", 2000);
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        throw new HttpError(400, 'Sandbox config field "server.readyUrl" must be a URL.');
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new HttpError(400, "Sandbox server.readyUrl must be http or https.");
      }
      readyUrl = parsed.toString();
    }
    config.server = {
      command,
      ...(readyUrl ? { readyUrl } : {}),
      ...(server.timeoutMs !== undefined
        ? { timeoutMs: clampNumber(server.timeoutMs, "server.timeoutMs", 1_000, 300_000) }
        : {}),
    };
  }

  if (record.timeoutMs !== undefined) {
    config.timeoutMs = clampNumber(record.timeoutMs, "timeoutMs", 10_000, 600_000);
  }
  if (record.concurrency !== undefined) {
    config.concurrency = clampNumber(record.concurrency, "concurrency", 1, 4);
  }
  if (record.coverage !== undefined) config.coverage = bool(record.coverage, "coverage");
  if (record.allowRepoToken !== undefined) {
    config.allowRepoToken = bool(record.allowRepoToken, "allowRepoToken");
  }
  if (record.v2 !== undefined) config.v2 = bool(record.v2, "v2");
  if (record.cwd !== undefined) config.cwd = relativeCwd(record.cwd);

  return config;
}

/**
 * The assertion header. `auto` and `custom` accept whatever driver is there;
 * the named drivers make the runner refuse a mismatch.
 */
function providerHeader(provider: SandboxProviderId | undefined): Record<string, string> {
  return provider && provider !== "auto" && provider !== "custom"
    ? { "x-sandbox-provider": provider }
    : {};
}

function stringsOf(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, content] of Object.entries(asRecord(value))) {
    if (typeof content === "string") result[key] = content;
  }
  return result;
}

function environmentErrorOf(value: unknown): SandboxRun["environmentError"] {
  return value === "setup" || value === "server" || value === "timeout" ? value : undefined;
}

function isolationOf(value: unknown): SandboxHealth["isolation"] {
  return value === "namespace" || value === "container" || value === "vm" || value === "none"
    ? value
    : undefined;
}

function coverageOf(value: unknown): CoverageReport | undefined {
  const record = asRecord(value);
  const lines = asRecord(record.lines);
  if (typeof lines.covered !== "number" || typeof lines.total !== "number") return undefined;
  const files = Array.isArray(record.files)
    ? record.files.flatMap((item) => {
        const file = asRecord(item);
        const fileLines = asRecord(file.lines);
        if (typeof file.path !== "string" || typeof fileLines.covered !== "number") return [];
        return [
          {
            path: file.path,
            lines: {
              covered: fileLines.covered,
              total: typeof fileLines.total === "number" ? fileLines.total : 0,
            },
            uncoveredLines: Array.isArray(file.uncoveredLines)
              ? file.uncoveredLines.filter((line): line is number => typeof line === "number")
              : [],
          },
        ];
      })
    : [];
  return {
    lines: { covered: lines.covered, total: lines.total },
    files,
  };
}

function requestBody(input: SandboxInput, sandbox: SandboxConfig): Record<string, unknown> {
  const repo = input.repo;
  const setup = input.setup ?? sandbox.setup;
  const env = input.env ?? sandbox.env;
  const server = input.server ?? sandbox.server;
  const cwd = input.cwd ?? sandbox.cwd;
  const coverage = input.coverage ?? (sandbox.coverage ? { format: "lcov" as const } : undefined);
  const v2 = Boolean(
    sandbox.v2 ||
    repo ||
    setup?.length ||
    env !== undefined ||
    server !== undefined ||
    cwd !== undefined ||
    coverage !== undefined,
  );

  const files = input.files ?? {};
  if (!v2) return { files, command: input.command };

  return {
    v: 2,
    ...(Object.keys(files).length > 0 ? { files } : {}),
    ...(repo ? { repo } : {}),
    ...(setup?.length ? { setup } : {}),
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
    ...(server ? { server } : {}),
    ...(cwd ? { cwd } : {}),
    ...(coverage ? { coverage } : {}),
    ...(sandbox.timeoutMs !== undefined ? { timeoutMs: sandbox.timeoutMs } : {}),
    command: input.command,
  };
}

export interface SandboxInput {
  sandbox?: SandboxConfig;
  files?: Record<string, string>;
  repo?: SandboxRepo;
  cwd?: string;
  setup?: string[];
  env?: Record<string, string>;
  server?: SandboxServer;
  coverage?: { format: "lcov" };
  command: string;
  fetchImpl?: typeof fetch;
}

/**
 * Runs one command in the sandbox. The runner may return the files it ended up
 * with, which is how a formatter returns formatted code.
 */
export async function runInSandbox(input: SandboxInput): Promise<SandboxRun> {
  const url = input.sandbox?.url?.trim();
  if (!url) {
    return {
      ok: false,
      exitCode: 1,
      output: "No sandbox runner is configured.",
      files: {},
      artifacts: {},
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...providerHeader(input.sandbox?.provider),
  };
  if (input.sandbox?.apiKey) headers.authorization = `Bearer ${input.sandbox.apiKey}`;

  const timeoutMs = Math.min(600_000, Math.max(10_000, input.sandbox?.timeoutMs ?? 120_000));
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody(input, input.sandbox ?? {})),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      exitCode: 1,
      output: `Sandbox unreachable: ${message}`,
      files: {},
      artifacts: {},
      unreachable: message,
      environmentError: "unreachable",
    };
  }

  const text = await response.text();
  let reply: SandboxReply = {};
  try {
    reply = asRecord(JSON.parse(text)) as SandboxReply;
  } catch {
    // Treated as a runner failure below.
  }

  if (!response.ok) {
    return {
      ok: false,
      exitCode: 1,
      output: `Sandbox returned ${response.status}: ${text.slice(0, 2000)}`,
      files: {},
      artifacts: {},
    };
  }

  const exitCode = Number(reply.exitCode ?? 1);
  const output = [reply.stdout, reply.stderr].filter(Boolean).join("\n").slice(0, 6000);
  const files = stringsOf(reply.files);
  const artifacts = stringsOf(reply.artifacts);
  const environmentError = environmentErrorOf(reply.environmentError);
  const coverage =
    coverageOf(reply.coverage) ??
    (input.coverage || input.sandbox?.coverage
      ? parseLcov(artifacts["coverage/lcov.info"] ?? "")
      : undefined);

  return {
    ok: exitCode === 0 && !reply.timedOut && !environmentError,
    exitCode,
    output,
    files,
    artifacts,
    ...(coverage ? { coverage } : {}),
    ...(reply.timedOut ? { timedOut: true } : {}),
    ...(environmentError ? { environmentError } : {}),
    ...(reply.timedOut && !environmentError ? { environmentError: "timeout" as const } : {}),
  };
}

/** Asks a runner for `/health`. Used by the Settings test button. */
export async function checkSandboxHealth(input: {
  sandbox?: SandboxConfig;
  fetchImpl?: typeof fetch;
}): Promise<SandboxHealth> {
  const url = input.sandbox?.url?.trim();
  if (!url) return { ok: false, error: "No sandbox runner is configured." };
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = providerHeader(input.sandbox?.provider);
  if (input.sandbox?.apiKey) headers.authorization = `Bearer ${input.sandbox.apiKey}`;

  try {
    const response = await fetchImpl(`${url.replace(/\/+$/, "")}/health`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = asRecord(JSON.parse(text));
    } catch {
      // The status code is still useful.
    }
    if (!response.ok) {
      return { ok: false, error: `Sandbox returned ${response.status}: ${text.slice(0, 300)}` };
    }
    return {
      ok: body.ok !== false,
      ...(typeof body.version === "string" ? { version: body.version } : {}),
      ...(Array.isArray(body.capabilities)
        ? {
            capabilities: body.capabilities.filter(
              (item): item is string => typeof item === "string",
            ),
          }
        : {}),
      ...(typeof body.provider === "string" ? { provider: body.provider } : {}),
      ...(isolationOf(body.isolation) ? { isolation: isolationOf(body.isolation) } : {}),
      ...(typeof body.error === "string" ? { error: body.error } : {}),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
