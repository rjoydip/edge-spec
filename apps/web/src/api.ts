/** Same-origin API client. Every call carries the visitor's own settings. */
import type { Provider } from "@edge-spec/core/catalog";
import type {
  Generation,
  RateLimitInfo,
  RunEvent,
  ScanResult,
  Validation,
} from "@edge-spec/core/types";
import type { PullSummary } from "@edge-spec/core/github";
import { getProject, requestHeaders, type Project, type Settings } from "./lib/settings";

export interface Catalog {
  providers: Provider[];
  defaults: { ai: { provider: string; model: string }; pipeline: Record<string, number | boolean> };
  sandbox: boolean;
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

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { ...requestHeaders(), ...init?.headers } });
  } catch (error) {
    throw new Error(
      `Cannot reach the Worker: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

export function fetchCatalog(): Promise<Catalog> {
  return apiJson<Catalog>("/api/catalog");
}

export interface Branches {
  branches: string[];
  defaultBranch: string;
}

export function fetchBranches(repo: string): Promise<Branches> {
  return apiJson<Branches>(`/api/branches?repo=${encodeURIComponent(repo)}`);
}

export function scanRepo(project: Project = getProject()): Promise<ScanResult> {
  return apiJson<ScanResult>("/api/scan", {
    method: "POST",
    body: JSON.stringify({
      repo: project.repo,
      ref: project.ref,
    }),
  });
}

export function fetchPulls(repo: string): Promise<{ pulls: PullSummary[] }> {
  return apiJson<{ pulls: PullSummary[] }>(`/api/pulls?repo=${encodeURIComponent(repo)}`);
}

export function regenerate(
  project: Project,
  settings: Settings,
  path: string,
  signal?: AbortSignal,
  previous?: { code: string; output: string },
): Promise<{
  generation: Generation;
  validation: Validation;
  attempts: number;
  rateLimit?: RateLimitInfo;
}> {
  return apiJson<{
    generation: Generation;
    validation: Validation;
    attempts: number;
    rateLimit?: RateLimitInfo;
  }>("/api/generate", {
    method: "POST",
    ...(signal ? { signal } : {}),
    body: JSON.stringify({
      repo: project.repo,
      ref: project.ref,
      path,
      provider: settings.provider,
      model: settings.model,
      accountId: settings.accountId,
      coverageTarget: settings.coverageTarget,
      strictTypes: settings.strictTypes,
      maxRetries: settings.maxRetries,
      maxAiRetries: settings.maxAiRetries,
      ...(previous ? { previous } : {}),
    }),
  });
}

/** Asks the provider how many calls are left. */
export function fetchQuota(
  project: Project,
  settings: Settings,
): Promise<{ rateLimit?: RateLimitInfo }> {
  const query = new URLSearchParams({
    provider: settings.provider,
    model: settings.model,
    accountId: settings.accountId,
  });
  return apiJson<{ rateLimit?: RateLimitInfo }>(`/api/quota?${query.toString()}`);
}

export interface PullFile {
  sourcePath: string;
  path: string;
  code: string;
}

/** Opens one pull request that carries every listed test file. */
export function openPullWithFiles(
  project: Project,
  settings: Settings,
  files: PullFile[],
): Promise<{ url: string; files: number }> {
  return apiJson<{ url: string; files: number }>("/api/pull-request", {
    method: "POST",
    body: JSON.stringify({
      repo: project.repo,
      ref: project.ref,
      strictTypes: settings.strictTypes,
      files: files.map((file) => ({
        path: file.path,
        code: file.code,
        sourcePath: file.sourcePath,
      })),
    }),
  });
}

/** Streams one pipeline run. Resolves when the stream ends. */
export async function runPipelineStream(
  project: Project,
  settings: Settings,
  onEvent: (event: RunEvent) => void,
  signal?: AbortSignal,
  /** Re-run only these gap paths, skipping the scan stage. */
  retryGaps?: string[],
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/run", {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({
        repo: project.repo,
        ref: project.ref,
        provider: settings.provider,
        model: settings.model,
        accountId: settings.accountId,
        maxRetries: settings.maxRetries,
        maxAiRetries: settings.maxAiRetries,
        maxFiles: settings.maxFiles,
        strictTypes: settings.strictTypes,
        coverageTarget: settings.coverageTarget,
        ...(retryGaps && retryGaps.length > 0 ? { retryGaps } : {}),
      }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw new Error(
      `Cannot reach the Worker: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) throw new Error(await errorMessage(response));
  const body = response.body;
  if (!body) throw new Error("The Worker returned no stream.");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    try {
      const event = JSON.parse(data) as RunEvent;
      if (event && typeof event.type === "string") onEvent(event);
    } catch {
      // A malformed frame must not kill the stream.
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) dispatch(block);
  }
  if (buffer.trim()) dispatch(buffer);
}
