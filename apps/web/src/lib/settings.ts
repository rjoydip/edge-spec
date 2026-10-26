/**
 * Browser-side configuration. The deployment holds none of it: settings travel
 * with each request, and secrets are sent as headers only.
 */
import { useSyncExternalStore } from "react";
import {
  DEFAULT_AI,
  DEFAULT_PIPELINE,
  normalizeModel,
  providerById,
} from "@edge-spec/core/catalog";
import { parsePullPolicy, type PullPolicy } from "@edge-spec/core/policy";
import { sandboxProvidersFor, type SandboxProviderId } from "@edge-spec/core/sandbox";
import { isLocalDashboard, isLocalHost } from "./env";

export interface Settings {
  provider: string;
  /** Model id; for the private provider this is the free-text model name. */
  model: string;
  /** Only used by the private provider. */
  baseUrl: string;
  /** Optional Cloudflare account for Workers AI BYOK. */
  accountId: string;
  maxRetries: number;
  /** How many times to retry an AI call that fails before giving up. */
  maxAiRetries: number;
  strictTypes: boolean;
  coverageTarget: number;
  parallelGeneration: boolean;
  /** How many gap files one run generates tests for. */
  maxFiles: number;
  /** Per-file tasks in flight. Clamped 1–6, default 3. */
  concurrency: number;
  /** Provider-reported tokens one run may spend. 0 means no cap. */
  maxTokens: number;
  /** Pull-request gates. Stored locally; sent with the PR request, never a secret. */
  policy: PullPolicy;
  /** A runner the visitor owns; it executes the suite. */
  sandboxUrl: string;
  /** Which driver the runner must use; `auto` asserts nothing. */
  sandboxProvider: SandboxProviderId;
  /** Commands run in the sandbox before the test command, one per line. */
  sandboxSetup: string;
  /** `KEY=VALUE` lines passed to the sandbox process. */
  sandboxEnv: string;
  /** Command that boots the app for API tests. */
  sandboxServerCommand: string;
  /** URL polled until the app is ready. */
  sandboxReadyUrl: string;
  /** Sandbox timeout in milliseconds. */
  sandboxTimeoutMs: number;
  /** Sandbox runs in flight. */
  sandboxConcurrency: number;
  /** Ask the runner for a coverage report. */
  sandboxCoverage: boolean;
  /** Relative working directory inside the sandbox. */
  sandboxCwd: string;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: DEFAULT_AI.provider,
  model: DEFAULT_AI.model,
  baseUrl: "",
  accountId: "",
  maxRetries: DEFAULT_PIPELINE.maxRetries,
  maxAiRetries: DEFAULT_PIPELINE.maxAiRetries,
  strictTypes: DEFAULT_PIPELINE.strictTypes,
  coverageTarget: DEFAULT_PIPELINE.coverageTarget,
  parallelGeneration: DEFAULT_PIPELINE.parallelGeneration,
  maxFiles: DEFAULT_PIPELINE.maxFiles,
  concurrency: DEFAULT_PIPELINE.concurrency,
  maxTokens: DEFAULT_PIPELINE.maxTokens,
  policy: {},
  sandboxUrl: "",
  sandboxProvider: "auto",
  sandboxSetup: "",
  sandboxEnv: "",
  sandboxServerCommand: "",
  sandboxReadyUrl: "",
  sandboxTimeoutMs: 180000,
  sandboxConcurrency: 2,
  sandboxCoverage: false,
  sandboxCwd: "",
};

/** Repository state is deliberately separate from the Settings model. */
export interface Project {
  repo: string;
  ref: string;
  /** Start folder inside the repository; the scan still covers the whole repo. */
  folder: string;
  /** A local folder path. Only usable while the dashboard runs on localhost. */
  localPath: string;
}

export const DEFAULT_PROJECT: Project = {
  repo: "",
  ref: "",
  folder: "",
  localPath: "",
};

const SETTINGS_KEY = "edgespec:settings";
const PROJECT_KEY = "edgespec:project";
const GITHUB_KEY = "edgespec:github-token";
const AI_KEY = "edgespec:ai-key";
const SANDBOX_KEY = "edgespec:sandbox-key";

/** Header names. Keep in sync with `src/worker/index.ts`. */
export const TOKEN_HEADER = "x-github-token";
export const AI_KEY_HEADER = "x-ai-key";
export const AI_BASE_HEADER = "x-ai-base-url";
export const SANDBOX_URL_HEADER = "x-sandbox-url";
export const SANDBOX_KEY_HEADER = "x-sandbox-key";
/** Non-secret runner knobs: setup, env, server, timeout, coverage. */
export const SANDBOX_CONFIG_HEADER = "x-sandbox-config";
/** Asks the Worker for its own Workers AI binding. Local development only. */
export const DEPLOYMENT_AI_HEADER = "x-deployment-ai";

function readRaw(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeRaw(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Private mode: the value still applies for this session.
  }
}

function pickNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const provider = providerById(String(parsed.provider ?? ""))
      ? String(parsed.provider)
      : DEFAULT_AI.provider;
    // Drop a model id that is no longer in the catalog (for example a retired
    // Workers AI model) so a stale localStorage value cannot force a 5007.
    const model = normalizeModel(provider, typeof parsed.model === "string" ? parsed.model : "");
    return {
      provider,
      model,
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      accountId: typeof parsed.accountId === "string" ? parsed.accountId : "",
      maxRetries: Math.min(
        5,
        Math.max(0, pickNumber(parsed.maxRetries, DEFAULT_PIPELINE.maxRetries)),
      ),
      maxAiRetries: Math.min(
        5,
        Math.max(0, pickNumber(parsed.maxAiRetries, DEFAULT_PIPELINE.maxAiRetries)),
      ),
      strictTypes: parsed.strictTypes !== false,
      parallelGeneration: parsed.parallelGeneration !== false,
      maxFiles: Math.min(50, Math.max(1, pickNumber(parsed.maxFiles, DEFAULT_PIPELINE.maxFiles))),
      concurrency: Math.min(
        6,
        Math.max(1, Math.round(pickNumber(parsed.concurrency, DEFAULT_PIPELINE.concurrency))),
      ),
      maxTokens: Math.min(
        2_000_000,
        Math.max(0, Math.round(pickNumber(parsed.maxTokens, DEFAULT_PIPELINE.maxTokens))),
      ),
      policy: parsePullPolicy(parsed.policy),
      sandboxUrl: typeof parsed.sandboxUrl === "string" ? parsed.sandboxUrl : "",
      sandboxProvider: sandboxProvidersFor(isLocalDashboard() ? "local" : "deployed").some(
        (entry) => entry.id === parsed.sandboxProvider,
      )
        ? (parsed.sandboxProvider as SandboxProviderId)
        : "auto",
      sandboxSetup: typeof parsed.sandboxSetup === "string" ? parsed.sandboxSetup : "",
      sandboxEnv: typeof parsed.sandboxEnv === "string" ? parsed.sandboxEnv : "",
      sandboxServerCommand:
        typeof parsed.sandboxServerCommand === "string" ? parsed.sandboxServerCommand : "",
      sandboxReadyUrl: typeof parsed.sandboxReadyUrl === "string" ? parsed.sandboxReadyUrl : "",
      sandboxTimeoutMs: Math.min(
        600_000,
        Math.max(10_000, pickNumber(parsed.sandboxTimeoutMs, 180_000)),
      ),
      sandboxConcurrency: Math.min(
        4,
        Math.max(1, Math.round(pickNumber(parsed.sandboxConcurrency, 2))),
      ),
      sandboxCoverage: parsed.sandboxCoverage === true,
      sandboxCwd: typeof parsed.sandboxCwd === "string" ? parsed.sandboxCwd : "",
      coverageTarget: Math.min(
        100,
        Math.max(0, pickNumber(parsed.coverageTarget, DEFAULT_PIPELINE.coverageTarget)),
      ),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let state: Settings = load();
const settingsListeners = new Set<() => void>();

export function getSettings(): Settings {
  return state;
}

export function setSettings(next: Partial<Settings>): void {
  state = { ...state, ...next };
  writeRaw(SETTINGS_KEY, JSON.stringify(state));
  for (const listener of settingsListeners) listener();
}

function subscribeSettings(listener: () => void): () => void {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}

const settingsSnapshot = (): Settings => state;

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, settingsSnapshot, settingsSnapshot);
}

function loadProject(): Project {
  try {
    const raw = window.localStorage.getItem(PROJECT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Project>;
      return {
        repo: typeof parsed.repo === "string" ? parsed.repo : "",
        ref: typeof parsed.ref === "string" ? parsed.ref : "",
        folder: typeof parsed.folder === "string" ? parsed.folder : "",
        localPath: typeof parsed.localPath === "string" ? parsed.localPath : "",
      };
    }
    // Migrate the old combined settings blob.
    const legacyRaw = window.localStorage.getItem(SETTINGS_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as { repo?: unknown; ref?: unknown };
      return {
        repo: typeof legacy.repo === "string" ? legacy.repo : "",
        ref: typeof legacy.ref === "string" ? legacy.ref : "",
        folder: "",
        localPath: "",
      };
    }
  } catch {
    // Fall through to the empty project.
  }
  return DEFAULT_PROJECT;
}

let project: Project = loadProject();
const projectListeners = new Set<() => void>();

export function getProject(): Project {
  return project;
}

export function setProject(next: Partial<Project>): void {
  project = { ...project, ...next };
  writeRaw(PROJECT_KEY, JSON.stringify(project));
  for (const listener of projectListeners) listener();
}

function subscribeProject(listener: () => void): () => void {
  projectListeners.add(listener);
  return () => {
    projectListeners.delete(listener);
  };
}

const projectSnapshot = (): Project => project;

export function useProject(): Project {
  return useSyncExternalStore(subscribeProject, projectSnapshot, projectSnapshot);
}

export interface Secrets {
  githubToken: string;
  aiKey: string;
  /** Key for the visitor's own test runner. */
  sandboxKey: string;
}

let secrets: Secrets = {
  githubToken: readRaw(GITHUB_KEY),
  aiKey: readRaw(AI_KEY),
  sandboxKey: readRaw(SANDBOX_KEY),
};
const secretListeners = new Set<() => void>();

export function getSecrets(): Secrets {
  return secrets;
}

export function setSecrets(next: Partial<Secrets>): void {
  secrets = { ...secrets, ...next };
  writeRaw(GITHUB_KEY, secrets.githubToken.trim());
  writeRaw(AI_KEY, secrets.aiKey.trim());
  writeRaw(SANDBOX_KEY, secrets.sandboxKey.trim());
  for (const listener of secretListeners) listener();
}

export function clearSecrets(): void {
  setSecrets({ githubToken: "", aiKey: "", sandboxKey: "" });
}

function subscribeSecrets(listener: () => void): () => void {
  secretListeners.add(listener);
  return () => {
    secretListeners.delete(listener);
  };
}

const secretsSnapshot = (): Secrets => secrets;

export function useSecrets(): Secrets {
  return useSyncExternalStore(subscribeSecrets, secretsSnapshot, secretsSnapshot);
}

/** `KEY=VALUE` lines to an object. Invalid lines are ignored by the UI; the Worker validates. */
export function parseEnvLines(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    if (!key) continue;
    env[key] = line.slice(equals + 1).trim();
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

/**
 * The non-secret runner configuration sent as one JSON header. URL and key stay
 * separate; an empty config is omitted.
 */
export function sandboxConfigOf(settings: Settings): Record<string, unknown> | undefined {
  const setup = settings.sandboxSetup
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const env = parseEnvLines(settings.sandboxEnv);
  const serverCommand = settings.sandboxServerCommand.trim();
  const readyUrl = settings.sandboxReadyUrl.trim();
  const cwd = settings.sandboxCwd.trim();
  const extras = Boolean(
    setup.length ||
    env ||
    serverCommand ||
    readyUrl ||
    cwd ||
    settings.sandboxProvider !== "auto" ||
    settings.sandboxCoverage ||
    settings.sandboxUrl.trim(),
  );
  if (!extras) return undefined;

  return {
    timeoutMs: settings.sandboxTimeoutMs,
    concurrency: settings.sandboxConcurrency,
    ...(settings.sandboxProvider !== "auto" ? { provider: settings.sandboxProvider } : {}),
    ...(setup.length > 0 ? { setup } : {}),
    ...(env ? { env } : {}),
    ...(serverCommand
      ? {
          server: {
            command: serverCommand,
            ...(readyUrl ? { readyUrl } : {}),
          },
        }
      : {}),
    ...(cwd ? { cwd } : {}),
    ...(settings.sandboxCoverage ? { coverage: true } : {}),
  };
}

/** Headers for one API call. Empty values are omitted, never sent as "undefined". */
export function requestHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secrets.githubToken.trim()) headers[TOKEN_HEADER] = secrets.githubToken.trim();
  if (secrets.aiKey.trim()) headers[AI_KEY_HEADER] = secrets.aiKey.trim();
  if (state.provider === "private" && state.baseUrl.trim()) {
    headers[AI_BASE_HEADER] = state.baseUrl.trim();
  }
  // The deployment binding is only offered on a local Worker, so a deployed
  // dashboard always runs on the visitor's own provider.
  if (state.provider === "workers-ai" && !secrets.aiKey.trim() && isLocalHost()) {
    headers[DEPLOYMENT_AI_HEADER] = "1";
  }
  if (state.sandboxUrl.trim()) {
    headers[SANDBOX_URL_HEADER] = state.sandboxUrl.trim();
    if (secrets.sandboxKey.trim()) headers[SANDBOX_KEY_HEADER] = secrets.sandboxKey.trim();
  }
  const sandboxConfig = sandboxConfigOf(state);
  if (sandboxConfig) headers[SANDBOX_CONFIG_HEADER] = JSON.stringify(sandboxConfig);
  return headers;
}
