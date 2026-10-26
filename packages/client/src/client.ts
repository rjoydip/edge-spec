/**
 * HTTP client for an EdgeSpec Worker. The CLI and MCP server use it so they
 * exercise the same scan/generate/run/PR code as the dashboard.
 */
import type { Provider } from "@edge-spec/core/catalog";
import type {
  Generation,
  RateLimitInfo,
  RunEvent,
  ScanResult,
  Validation,
} from "@edge-spec/core/types";
import type { Env } from "./env";
import { envDefaults } from "./env";

export interface Catalog {
  providers: Provider[];
  defaults: {
    ai: { provider: string; model: string };
    pipeline: Record<string, number | boolean>;
  };
  sandbox: boolean;
}

export interface ClientConfig {
  baseUrl: string;
  githubToken?: string;
  aiKey?: string;
  aiBaseUrl?: string;
  sandboxUrl?: string;
  sandboxKey?: string;
  /** Non-secret runner knobs as JSON; the Worker validates it. */
  sandboxConfig?: string;
  deploymentAi?: boolean;
  fetchImpl?: typeof fetch;
}

export interface GenerateRequest {
  repo: string;
  ref?: string;
  path: string;
  provider?: string;
  model?: string;
  accountId?: string;
  coverageTarget?: number;
  strictTypes?: boolean;
  maxRetries?: number;
  maxAiRetries?: number;
  previous?: { code: string; output: string };
}

export interface GenerateResponse {
  generation: Generation;
  validation: Validation;
  attempts: number;
  rateLimit?: RateLimitInfo;
}

export interface RunRequest {
  repo: string;
  ref?: string;
  provider?: string;
  model?: string;
  accountId?: string;
  maxRetries?: number;
  maxAiRetries?: number;
  maxFiles?: number;
  maxTokens?: number;
  flakyRuns?: number;
  mutationCommand?: string;
  strictTypes?: boolean;
  coverageTarget?: number;
  retryGaps?: string[];
}

export interface PullRequestRequest {
  repo: string;
  files: Array<{ path: string; code: string; sourcePath?: string }>;
  strictTypes?: boolean;
}

export function clientConfigFromEnv(env: Env, provider?: string): ClientConfig {
  const defaults = envDefaults(env, provider);
  return {
    baseUrl: defaults.baseUrl,
    ...(defaults.githubToken ? { githubToken: defaults.githubToken } : {}),
    ...(defaults.aiKey ? { aiKey: defaults.aiKey } : {}),
    ...(defaults.aiBaseUrl ? { aiBaseUrl: defaults.aiBaseUrl } : {}),
    ...(defaults.sandboxUrl ? { sandboxUrl: defaults.sandboxUrl } : {}),
    ...(defaults.sandboxKey ? { sandboxKey: defaults.sandboxKey } : {}),
    ...(defaults.sandboxConfig ? { sandboxConfig: defaults.sandboxConfig } : {}),
    deploymentAi: defaults.deploymentAi,
  };
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // Not JSON; use the raw text below.
  }
  return text.slice(0, 400) || `Request failed (${response.status}).`;
}

function hasType(value: unknown): value is RunEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

export class EdgeSpecClient {
  private readonly baseUrl: string;
  private readonly config: ClientConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ClientConfig) {
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error(`Invalid EdgeSpec URL: "${config.baseUrl}"`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("The EdgeSpec URL must use http or https.");
    }
    this.baseUrl = baseUrl;
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private headers(json = false): Record<string, string> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (json) headers["content-type"] = "application/json";
    if (this.config.githubToken) headers["x-github-token"] = this.config.githubToken;
    if (this.config.aiKey) headers["x-ai-key"] = this.config.aiKey;
    if (this.config.aiBaseUrl) headers["x-ai-base-url"] = this.config.aiBaseUrl;
    if (this.config.sandboxUrl) headers["x-sandbox-url"] = this.config.sandboxUrl;
    if (this.config.sandboxKey) headers["x-sandbox-key"] = this.config.sandboxKey;
    if (this.config.sandboxConfig) headers["x-sandbox-config"] = this.config.sandboxConfig;
    if (this.config.deploymentAi) headers["x-deployment-ai"] = "1";
    return headers;
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: this.headers(init.body !== undefined),
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch (error) {
      throw new Error(
        `Cannot reach EdgeSpec at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) throw new Error(await errorMessage(response));
    return (await response.json()) as T;
  }

  catalog(): Promise<Catalog> {
    return this.request("/api/catalog");
  }

  scan(input: { repo: string; ref?: string }): Promise<ScanResult> {
    return this.request("/api/scan", {
      method: "POST",
      body: { repo: input.repo, ref: input.ref ?? "main" },
    });
  }

  generate(input: GenerateRequest): Promise<GenerateResponse> {
    const {
      repo,
      ref,
      path,
      provider,
      model,
      accountId,
      coverageTarget,
      strictTypes,
      maxRetries,
      maxAiRetries,
      previous,
    } = input;
    return this.request("/api/generate", {
      method: "POST",
      body: {
        repo,
        ref: ref ?? "main",
        path,
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(accountId ? { accountId } : {}),
        ...(coverageTarget !== undefined ? { coverageTarget } : {}),
        ...(strictTypes !== undefined ? { strictTypes } : {}),
        ...(maxRetries !== undefined ? { maxRetries } : {}),
        ...(maxAiRetries !== undefined ? { maxAiRetries } : {}),
        ...(previous ? { previous } : {}),
      },
    });
  }

  /** Streams one pipeline run, invoking `onEvent` as frames arrive. */
  async run(
    input: RunRequest,
    onEvent?: (event: RunEvent) => void,
    signal?: AbortSignal,
  ): Promise<RunEvent[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/run`, {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({
          repo: input.repo,
          ref: input.ref ?? "main",
          ...(input.provider ? { provider: input.provider } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.accountId ? { accountId: input.accountId } : {}),
          ...(input.maxRetries !== undefined ? { maxRetries: input.maxRetries } : {}),
          ...(input.maxAiRetries !== undefined ? { maxAiRetries: input.maxAiRetries } : {}),
          ...(input.maxFiles !== undefined ? { maxFiles: input.maxFiles } : {}),
          ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
          ...(input.flakyRuns !== undefined ? { flakyRuns: input.flakyRuns } : {}),
          ...(input.mutationCommand ? { mutationCommand: input.mutationCommand } : {}),
          ...(input.strictTypes !== undefined ? { strictTypes: input.strictTypes } : {}),
          ...(input.coverageTarget !== undefined ? { coverageTarget: input.coverageTarget } : {}),
          ...(input.retryGaps?.length ? { retryGaps: input.retryGaps } : {}),
        }),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new Error(
        `Cannot reach EdgeSpec at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) throw new Error(await errorMessage(response));
    if (!response.body) throw new Error("EdgeSpec returned no event stream.");

    const events: RunEvent[] = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const dispatch = (block: string) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) return;
      try {
        const event = JSON.parse(data) as unknown;
        if (!hasType(event)) return;
        events.push(event);
        onEvent?.(event);
      } catch {
        // A malformed frame must not kill the stream.
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) dispatch(block);
    }
    if (buffer.trim()) dispatch(buffer);
    return events;
  }

  openPullRequest(input: PullRequestRequest): Promise<{ url: string; files: number }> {
    return this.request("/api/pull-request", {
      method: "POST",
      body: {
        repo: input.repo,
        ...(input.strictTypes !== undefined ? { strictTypes: input.strictTypes } : {}),
        files: input.files.map((file) => ({
          path: file.path,
          code: file.code,
          sourcePath: file.sourcePath ?? file.path,
        })),
      },
    });
  }
}

export { envDefaults } from "./env";
export type { Env, EnvDefaults } from "./env";
