/**
 * Provider and model catalog, plus the rules for what a usable choice looks
 * like. The dashboard renders Settings from this; the Worker enforces it.
 */
import { HttpError } from "./types";

export type Protocol = "workers-ai" | "openai" | "anthropic" | "google";

export interface ModelChoice {
  id: string;
  name: string;
  /** Rough guidance for the UI, not an enforcement rule. */
  note?: string;
}

export interface Provider {
  id: string;
  name: string;
  protocol: Protocol;
  /** Origin for the provider's API. Missing for Workers AI and custom URLs. */
  baseUrl?: string;
  /** Cloudflare Workers AI is the only provider that needs no key. */
  needsKey: boolean;
  /** OpenAI-compatible endpoint supplied by the user. */
  custom?: boolean;
  models: ModelChoice[];
  hint?: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: "workers-ai",
    name: "Cloudflare Workers AI",
    protocol: "workers-ai",
    needsKey: false,
    models: [
      { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Instruct" },
      { id: "@cf/qwen/qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B" },
      { id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", name: "DeepSeek R1 Distill 32B" },
      { id: "@cf/meta/llama-3.1-8b-instruct-fp8", name: "Llama 3.1 8B Instruct" },
    ],
    hint: "Uses the deployment's Workers AI binding by default. Add a Cloudflare account ID and API token in Settings to use your own account.",
  },
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    models: [
      { id: "gpt-6-astra", name: "GPT-6 Astra" },
      { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
      { id: "gpt-6-luna", name: "GPT-6 Luna" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    needsKey: true,
    models: [
      { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
      { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    protocol: "google",
    baseUrl: "https://generativelanguage.googleapis.com",
    needsKey: true,
    models: [
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
      { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite" },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        note: "Google limits the 2.5 models to accounts that have used them.",
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        note: "Google limits the 2.5 models to accounts that have used them.",
      },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    protocol: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    needsKey: true,
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" },
      { id: "qwen-2.5-coder-32b", name: "Qwen 2.5 Coder 32B" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    needsKey: true,
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    protocol: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    needsKey: true,
    models: [
      { id: "mistral-large-latest", name: "Mistral Large" },
      { id: "codestral-latest", name: "Codestral" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    models: [
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
      { id: "openai/gpt-4.1", name: "GPT-4.1" },
      { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
    ],
  },
  {
    id: "private",
    name: "Custom provider",
    protocol: "openai",
    needsKey: false,
    custom: true,
    models: [],
    hint: "Bring any OpenAI-compatible endpoint and key: vLLM, Ollama, LiteLLM, or an internal gateway.",
  },
];

export const DEFAULT_AI = {
  provider: "workers-ai",
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
} as const;

export const DEFAULT_PIPELINE = {
  maxRetries: 2,
  maxAiRetries: 2,
  autoPr: true,
  strictTypes: true,
  coverageTarget: 90,
  parallelGeneration: true,
  maxFiles: 10,
  concurrency: 3,
  /** 0 means no cap. Measured from provider-reported usage. */
  maxTokens: 0,
  /** Extra repeats after a passing run; 0 disables flaky detection. */
  flakyRuns: 2,
  /** Empty means mutation is not measured. `{file}`/`{test}` are substituted. */
  mutationCommand: "",
  /** Opt-in fast-check properties; off by default because cost and flake are real. */
  propertyTests: false,
} as const;

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function modelById(provider: Provider, id: string): ModelChoice | undefined {
  return provider.models.find((m) => m.id === id);
}

/** The next catalog model for a provider, used once when one is unavailable. */
export function nextModel(provider: Provider, model: string): string | undefined {
  const index = provider.models.findIndex((m) => m.id === model);
  return index >= 0 ? provider.models[index + 1]?.id : provider.models[0]?.id;
}

/** Keeps a stored model only while the provider still offers it. */
export function normalizeModel(providerId: string, stored?: string): string {
  const provider = providerById(providerId);
  const text = stored?.trim() ?? "";
  if (!provider) return text || DEFAULT_AI.model;
  const fallback = provider.models[0]?.id ?? "";
  return provider.custom || (text && modelById(provider, text)) ? text || fallback : fallback;
}

/**
 * Resolves the request's AI choice against the catalog and throws a 400 with a
 * readable message when it is incomplete. Runs before any network call.
 */
export function resolveAi(choice: {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  accountId?: string;
}): { provider: Provider; model: string; apiKey?: string; baseUrl?: string; accountId?: string } {
  const provider = providerById((choice.provider ?? DEFAULT_AI.provider).trim());
  if (!provider) {
    throw new HttpError(400, `Unknown AI provider: "${choice.provider ?? ""}"`);
  }

  const model = (choice.model ?? provider.models[0]?.id ?? "").trim();
  if (!model) throw new HttpError(400, "No AI model selected.");
  if (!provider.custom && !modelById(provider, model)) {
    throw new HttpError(400, `Model "${model}" is not available for ${provider.name}.`);
  }

  const apiKey = choice.apiKey?.trim() || undefined;
  if (provider.needsKey && !apiKey) {
    throw new HttpError(400, `${provider.name} requires your API key. Add it in Settings.`);
  }

  const accountId = choice.accountId?.trim() || undefined;
  if (provider.protocol === "workers-ai" && accountId && !/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new HttpError(400, "The Cloudflare account ID must be 32 hexadecimal characters.");
  }
  // Workers AI runs on your own Cloudflare account over REST, and that needs
  // the account and the token together. One without the other is a mistake,
  // not a half configuration.
  if (provider.protocol === "workers-ai" && Boolean(accountId) !== Boolean(apiKey)) {
    throw new HttpError(
      400,
      "Workers AI on your own account needs both the Cloudflare account ID and the API token. Fill in both, or leave both empty to use the deployment binding.",
    );
  }

  if (!provider.custom) {
    // A caller may not redirect a known provider at another origin: that would
    // let a request send a real provider key to an arbitrary host.
    return { provider, model, apiKey, baseUrl: provider.baseUrl, accountId };
  }

  const raw = choice.baseUrl?.trim();
  if (!raw) throw new HttpError(400, "The custom provider needs a base URL.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, `Not a valid base URL: "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "The base URL must be http or https.");
  }
  return { provider, model, apiKey, baseUrl: raw.replace(/\/+$/, "") };
}

function validRepoPart(part: string): boolean {
  return (
    part.length > 0 &&
    part !== "." &&
    part !== ".." &&
    !part.startsWith(".") &&
    /^[A-Za-z0-9_.-]+$/.test(part)
  );
}

/** `owner/name`, a GitHub URL, or a clone URL. Returns null when unusable. */
export function parseRepo(input: string | undefined): { owner: string; name: string } | null {
  const raw = input?.trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/");
  if (parts.length !== 2) return null;
  const [owner, name] = parts as [string, string];
  if (!validRepoPart(owner) || !validRepoPart(name)) return null;
  return { owner, name };
}

export interface RepoInput {
  owner: string;
  name: string;
  /** A subfolder to start in. The whole repository is still scanned. */
  folder?: string;
  /** A branch encoded in a GitHub tree URL. */
  ref?: string;
}

/**
 * `owner/name`, a GitHub URL, a clone URL, or a folder path inside one.
 * A folder is only a starting point: callers still scan the whole repository.
 */
export function parseRepoInput(input: string | undefined): RepoInput | null {
  const raw = input?.trim();
  if (!raw) return null;
  // Absolute POSIX paths are local, not a GitHub repository.
  if (raw.startsWith("/")) return null;
  const githubUrl = /^(?:https?:\/\/)?(?:www\.)?github\.com\//i.test(raw);
  const cleaned = (githubUrl ? raw.replace(/[?#].*$/, "") : raw)
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git(?=\/|$)/i, "")
    .replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const name = parts[1]?.replace(/\.git$/i, "");
  if (!owner || !name || !validRepoPart(owner) || !validRepoPart(name)) return null;

  let rest = parts.slice(2);
  let ref: string | undefined;
  if (rest[0] === "tree") {
    const branch = rest[1];
    if (!branch) return null;
    try {
      ref = parseRef(decodeURIComponent(branch));
    } catch {
      return null;
    }
    rest = rest.slice(2);
  }

  const folder: string[] = [];
  for (const part of rest) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      return null;
    }
    folder.push(decoded);
  }

  return {
    owner,
    name,
    ...(folder.length > 0 ? { folder: folder.join("/") } : {}),
    ...(ref ? { ref } : {}),
  };
}

export function parseRef(input: string | undefined): string {
  const ref = (input ?? "main").trim() || "main";
  if (!/^[A-Za-z0-9._/-]+$/.test(ref) || ref.includes("..") || ref.startsWith("/")) {
    throw new HttpError(400, `Not a valid branch name: "${ref}"`);
  }
  return ref;
}

/** Clamps the pipeline knobs so a hostile request cannot spin forever. */
export interface PipelineConfigInput {
  maxRetries?: unknown;
  maxAiRetries?: unknown;
  autoPr?: unknown;
  strictTypes?: unknown;
  coverageTarget?: unknown;
  maxFiles?: unknown;
  parallelGeneration?: unknown;
  concurrency?: unknown;
  /** Provider-reported tokens one run may spend; 0 means no cap. */
  maxTokens?: unknown;
  /** Extra repeats after a passing run; 0 disables flaky detection. */
  flakyRuns?: unknown;
  /** Stryker-compatible command; empty means not measured. */
  mutationCommand?: unknown;
  /** Opt-in fast-check properties. */
  propertyTests?: unknown;
}

export function pipelineConfig(input: PipelineConfigInput): {
  maxRetries: number;
  maxAiRetries: number;
  autoPr: boolean;
  strictTypes: boolean;
  coverageTarget: number;
  maxFiles: number;
  parallelGeneration: boolean;
  concurrency: number;
  maxTokens: number;
  flakyRuns: number;
  mutationCommand: string;
  propertyTests: boolean;
} {
  const retries = Number(input.maxRetries);
  const aiRetries = Number(input.maxAiRetries);
  const target = Number(input.coverageTarget);
  const files = Number(input.maxFiles);
  const concurrency = Number(input.concurrency);
  const tokens = Number(input.maxTokens);
  const flaky = Number(input.flakyRuns);
  const mutationCommand =
    typeof input.mutationCommand === "string" ? input.mutationCommand.trim().slice(0, 500) : "";
  return {
    maxRetries: Number.isFinite(retries) ? Math.min(5, Math.max(0, Math.round(retries))) : 2,
    maxAiRetries: Number.isFinite(aiRetries) ? Math.min(5, Math.max(0, Math.round(aiRetries))) : 2,
    autoPr: input.autoPr !== false,
    strictTypes: input.strictTypes !== false,
    coverageTarget: Number.isFinite(target) ? Math.min(100, Math.max(0, Math.round(target))) : 90,
    maxFiles: Number.isFinite(files) ? Math.min(50, Math.max(1, Math.round(files))) : 10,
    parallelGeneration: input.parallelGeneration !== false,
    concurrency: Number.isFinite(concurrency)
      ? Math.min(6, Math.max(1, Math.round(concurrency)))
      : 3,
    maxTokens: Number.isFinite(tokens) ? Math.min(2_000_000, Math.max(0, Math.round(tokens))) : 0,
    flakyRuns: Number.isFinite(flaky) ? Math.min(5, Math.max(0, Math.round(flaky))) : 2,
    mutationCommand,
    propertyTests: input.propertyTests === true,
  };
}

/** Loopback names and addresses. */
function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());
}

/** Private, link-local and reserved hosts a deployed Worker must not fetch. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return true;
  }
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export interface SandboxUrlOptions {
  /** Local development may target loopback; a deployed Worker must not. */
  allowLocal?: boolean;
}

/**
 * A runner URL the visitor supplied. The Worker fetches it, so only https is
 * accepted, or http for a runner on the same machine. A deployed request may
 * not target loopback or private hosts.
 */
export function parseSandboxUrl(
  input: string | undefined,
  options: SandboxUrlOptions = {},
): string | null {
  const allowLocal = options.allowLocal !== false;
  const raw = (input ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = isLoopbackHost(url.hostname);
  if (!allowLocal && (local || isPrivateHost(url.hostname))) return null;
  if (url.protocol === "https:") return url.toString();
  if (url.protocol === "http:" && local) return url.toString();
  return null;
}
