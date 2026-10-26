/**
 * The EdgeSpec sandbox contract, implemented on Cloudflare Sandbox. Parsing and
 * path rules stay pure so they can be tested without a container.
 */
export const MAX_BODY_BYTES = 10_000_000;
export const OUTPUT_CAP = 1_000_000;
export const ARTIFACT_CAP = 5_000_000;
export const REMOTE_ROOT = "/workspace";
export const REMOTE_REPO = `${REMOTE_ROOT}/repo`;

/** Files the runner returns when present; never an unbounded directory read. */
export const ARTIFACT_PATHS = [
  "coverage/lcov.info",
  "junit.xml",
  "test-results/junit.xml",
  "recorded-fixtures.json",
  "mutation.json",
  "reports/mutation/mutation.json",
] as const;

export interface RunRepo {
  url: string;
  ref?: string;
  /** Used only for the clone; never written into a command. */
  token?: string;
}

export interface RunServer {
  command: string;
  readyUrl?: string;
  timeoutMs?: number;
}

export interface RunRequest {
  files: Record<string, string>;
  repo?: RunRepo;
  cwd?: string;
  setup: string[];
  env: Record<string, string>;
  server?: RunServer;
  command: string;
  timeoutMs?: number;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const text = (value: unknown, field: string, max: number): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`"${field}" must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`"${field}" is longer than ${max} characters.`);
  return trimmed;
};

const clamp = (value: unknown, field: string, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`"${field}" must be a number.`);
  }
  return Math.min(max, Math.max(min, Math.round(value)));
};

/** `a/b.ts` is allowed; absolute paths and `..` are not. */
export function safeRelative(value: unknown, field: string): string {
  const path = text(value, field, 300).replace(/\\/g, "/");
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").includes("..")) {
    throw new Error(`"${field}" must stay inside the workspace.`);
  }
  return path.replace(/^\.\//, "");
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseFiles(value: unknown): Record<string, string> {
  const record = asRecord(value) ?? {};
  const entries = Object.entries(record);
  if (entries.length > 500) throw new Error("At most 500 files are accepted.");
  const files: Record<string, string> = {};
  let bytes = 0;
  for (const [rawPath, content] of entries) {
    const path = safeRelative(rawPath, "files path");
    if (typeof content !== "string") throw new Error(`File "${path}" must be a string.`);
    bytes += content.length;
    files[path] = content;
  }
  if (bytes > MAX_BODY_BYTES) throw new Error("The request exceeds 10 MB.");
  return files;
}

function parseRepo(value: unknown): RunRepo | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (!record) throw new Error('"repo" must be an object.');
  const url = text(record.url, "repo.url", 500);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('"repo.url" must be a URL.');
  }
  if (parsed.protocol !== "https:") throw new Error('"repo.url" must use https.');
  const ref = record.ref === undefined ? undefined : text(record.ref, "repo.ref", 200);
  if (ref && !/^[A-Za-z0-9._/-]+$/.test(ref)) throw new Error('"repo.ref" is not a valid ref.');
  const token = record.token === undefined ? undefined : text(record.token, "repo.token", 500);
  return { url, ...(ref ? { ref } : {}), ...(token ? { token } : {}) };
}

function parseEnv(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  const record = asRecord(value);
  if (!record) throw new Error('"env" must be an object.');
  const entries = Object.entries(record);
  if (entries.length > 50) throw new Error("At most 50 environment variables are accepted.");
  const env: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (!ENV_KEY.test(key)) throw new Error(`"${key}" is not a valid environment variable.`);
    if (typeof raw !== "string" || raw.length > 4000) {
      throw new Error(`Environment value "${key}" must be a string under 4000 characters.`);
    }
    env[key] = raw;
  }
  return env;
}

function parseSetup(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error('"setup" must be an array of at most 20 commands.');
  }
  return value.map((command, index) => text(command, `setup[${index}]`, 1000));
}

function parseServer(value: unknown): RunServer | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (!record) throw new Error('"server" must be an object.');
  const command = text(record.command, "server.command", 1000);
  let readyUrl: string | undefined;
  if (record.readyUrl !== undefined) {
    const raw = text(record.readyUrl, "server.readyUrl", 2000);
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error('"server.readyUrl" must be http or https.');
    }
    readyUrl = parsed.toString();
  }
  return {
    command,
    ...(readyUrl ? { readyUrl } : {}),
    ...(record.timeoutMs !== undefined
      ? { timeoutMs: clamp(record.timeoutMs, "server.timeoutMs", 1_000, 300_000) }
      : {}),
  };
}

/** Validates a v1/v2 body. Throws with a message the caller can return as 400. */
export function parseRunRequest(value: unknown): RunRequest {
  const record = asRecord(value);
  if (!record) throw new Error("The request body must be an object.");
  const repo = parseRepo(record.repo);
  const server = parseServer(record.server);
  return {
    files: parseFiles(record.files),
    ...(repo ? { repo } : {}),
    ...(record.cwd === undefined ? {} : { cwd: safeRelative(record.cwd, "cwd") }),
    setup: parseSetup(record.setup),
    env: parseEnv(record.env),
    ...(server ? { server } : {}),
    command: text(record.command, "command", 2000),
    ...(record.timeoutMs === undefined
      ? {}
      : { timeoutMs: clamp(record.timeoutMs, "timeoutMs", 10_000, 600_000) }),
  };
}

/** The repository root, or a subdirectory of it, always inside the workspace. */
export function remoteCwd(root: string, cwd: string | undefined): string {
  if (!cwd) return root;
  const candidate = `${root.replace(/\/+$/, "")}/${cwd.replace(/^\/+/, "")}`;
  if (!candidate.startsWith(`${REMOTE_ROOT}/`)) {
    throw new Error("The working directory escapes the workspace.");
  }
  return candidate;
}

/** A single-quoted shell word, so a ref cannot inject a command. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Clone into `root`. The token travels in GIT_TOKEN, not in the command. */
export function cloneCommand(repo: RunRepo, root: string): string {
  const ref = repo.ref ? ` --branch ${shellQuote(repo.ref)}` : "";
  return [
    "git",
    "-c",
    `credential.helper='!f() { echo username=x-access-token; echo "password=$GIT_TOKEN"; }; f'`,
    "clone",
    "--depth",
    "1",
    ref,
    shellQuote(repo.url),
    shellQuote(root),
  ]
    .join(" ")
    .replace(/\s+/g, " ");
}

/** Status codes that mean the app answered, not that the port was merely open. */
export function isReadyStatus(status: number): boolean {
  return status >= 200 && status < 400;
}
