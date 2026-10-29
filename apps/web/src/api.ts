/** Same-origin API client. Every call carries the visitor's own settings. */
import type { Provider } from "@edge-spec/core/catalog";
import type {
  Generation,
  RateLimitInfo,
  RetestOperation,
  RunEvent,
  ScanResult,
  Validation,
} from "@edge-spec/core/types";
import type { PullSummary } from "@edge-spec/core/github";
import type { BacklogItem, BacklogState } from "@edge-spec/core/backlog";
import type { RunDecision, RunDetail, RunSummary } from "@edge-spec/core/history";
import type { RepoMemory } from "@edge-spec/core/memory";
import type { PullPolicy } from "@edge-spec/core/policy";
import type { PullFile } from "@edge-spec/core/pr";
import type { SkippedContractOperation } from "@edge-spec/core/provenance";
import { getProject, requestHeaders, type Project, type Settings } from "./lib/settings";

export interface Catalog {
  providers: Provider[];
  defaults: {
    ai: { provider: string; model: string };
    pipeline: Record<string, number | boolean>;
  };
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
    response = await fetch(path, {
      ...init,
      headers: { ...requestHeaders(), ...init?.headers },
    });
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

/** Mirrors `Capabilities` in the Worker's `platform.ts`. */
export interface DeploymentCapabilities {
  history: boolean;
  artifacts: boolean;
  jobs: "cloudflare-workflows" | "external" | "none";
  durableJobs: boolean;
  cache: "kv" | "redis" | "memory" | "none";
  cron: boolean;
  ai: "binding" | "env" | "byok-only";
  assets: boolean;
}

export interface Health {
  status: string;
  app: string;
  timestamp: string;
  capabilities: DeploymentCapabilities;
}

export function fetchHealth(): Promise<Health> {
  return apiJson<Health>("/api/health");
}

export interface SandboxHealth {
  ok: boolean;
  version?: string;
  capabilities?: string[];
  provider?: string;
  isolation?: "namespace" | "container" | "vm" | "none";
  error?: string;
}

/**
 * Probes a runner through the Worker. The Worker does the fetch, so an
 * arbitrary origin works and the key never has to be exposed cross-origin.
 */
export async function checkSandbox(
  url: string,
  key: string,
  config?: Record<string, unknown>,
): Promise<SandboxHealth> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (key.trim()) headers["x-sandbox-key"] = key.trim();
  if (config) headers["x-sandbox-config"] = JSON.stringify(config);

  let response: Response;
  try {
    response = await fetch("/api/sandbox/health", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: url.trim(), ...(config ? { config } : {}) }),
    });
  } catch (error) {
    throw new Error(
      `Cannot reach the Worker: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as SandboxHealth;
}

export interface Branches {
  branches: string[];
  defaultBranch: string;
}

export function fetchBranches(repo: string): Promise<Branches> {
  return apiJson<Branches>(`/api/branches?repo=${encodeURIComponent(repo)}`);
}

export function scanRepo(project: Project = getProject()): Promise<ScanResult> {
  if (project.localPath) {
    return apiJson<ScanResult>(`/local-api/scan?path=${encodeURIComponent(project.localPath)}`);
  }
  return apiJson<ScanResult>("/api/scan", {
    method: "POST",
    body: JSON.stringify({
      repo: project.repo,
      ref: project.ref,
    }),
  });
}

/** Reads one source file through the local Vite API. */
async function localSource(project: Project, path: string): Promise<string> {
  const result = await apiJson<{ source: string }>(
    `/local-api/file?root=${encodeURIComponent(project.localPath)}&path=${encodeURIComponent(path)}`,
  );
  return result.source;
}

export function fetchPulls(repo: string): Promise<{ pulls: PullSummary[] }> {
  return apiJson<{ pulls: PullSummary[] }>(`/api/pulls?repo=${encodeURIComponent(repo)}`);
}

export async function regenerate(
  project: Project,
  settings: Settings,
  path: string,
  signal?: AbortSignal,
  previous?: { code: string; output: string },
  targeting?: { uncoveredLines?: number[]; uncoveredBranches?: number[] },
): Promise<{
  generation: Generation;
  validation: Validation;
  attempts: number;
  rateLimit?: RateLimitInfo;
  /** Fallbacks and caveats the provider path produced. */
  notices?: string[];
}> {
  const body: Record<string, unknown> = {
    path,
    provider: settings.provider,
    model: settings.model,
    accountId: settings.accountId,
    coverageTarget: settings.coverageTarget,
    strictTypes: settings.strictTypes,
    maxRetries: settings.maxRetries,
    maxAiRetries: settings.maxAiRetries,
    flakyRuns: settings.flakyRuns,
    mutationCommand: settings.mutationCommand,
    propertyTests: settings.propertyTests,
    autoRouteModels: settings.autoRouteModels,
    ...(previous ? { previous } : {}),
    ...(targeting?.uncoveredLines?.length ? { uncoveredLines: targeting.uncoveredLines } : {}),
    ...(targeting?.uncoveredBranches?.length
      ? { uncoveredBranches: targeting.uncoveredBranches }
      : {}),
  };
  if (project.localPath) {
    body.source = await localSource(project, path);
  } else {
    body.repo = project.repo;
    body.ref = project.ref;
  }

  return apiJson<{
    generation: Generation;
    validation: Validation;
    attempts: number;
    rateLimit?: RateLimitInfo;
  }>("/api/generate", {
    method: "POST",
    ...(signal ? { signal } : {}),
    body: JSON.stringify(body),
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

export type { PullFile };

/** Optional copy the reviewer can edit in the pull request dialog. */
export interface PullMeta {
  title?: string;
  body?: string;
  branch?: string;
  commitMessage?: string;
  draft?: boolean;
  /** The run the accepted files came from, so history can record the decision. */
  runId?: string;
}

/** Opens one pull request that carries every listed test file. */
export function openPullWithFiles(
  project: Project,
  settings: Settings,
  files: PullFile[],
  meta?: PullMeta,
  skipped?: SkippedContractOperation[],
  policy?: PullPolicy,
): Promise<{ url: string; files: number }> {
  return apiJson<{ url: string; files: number }>("/api/pull-request", {
    method: "POST",
    body: JSON.stringify({
      repo: project.repo,
      ref: project.ref,
      strictTypes: settings.strictTypes,
      ...meta,
      ...(skipped && skipped.length > 0 ? { skipped } : {}),
      ...(policy && Object.keys(policy).length > 0 ? { policy } : {}),
      files: files.map((file) => ({
        path: file.path,
        code: file.code,
        sourcePath: file.sourcePath,
        ...(file.provider ? { provider: file.provider } : {}),
        ...(file.model ? { model: file.model } : {}),
        ...(file.promptVersion ? { promptVersion: file.promptVersion } : {}),
        ...(file.corrected ? { corrected: true } : {}),
        ...(file.flaky ? { flaky: true } : {}),
        ...(file.verified !== undefined ? { verified: file.verified } : {}),
        ...(file.checks ? { checks: file.checks } : {}),
        ...(file.coverage ? { coverage: file.coverage } : {}),
        ...(file.mutation ? { mutation: file.mutation } : {}),
      })),
    }),
  });
}

export interface BacklogResponse {
  enabled: boolean;
  items: BacklogItem[];
}

export function fetchBacklog(repo: string): Promise<BacklogResponse> {
  return apiJson<BacklogResponse>(`/api/backlog?repo=${encodeURIComponent(repo)}`);
}

export function updateBacklog(
  repo: string,
  path: string,
  state: BacklogState,
  owner?: string,
): Promise<{ updated: boolean }> {
  return apiJson<{ updated: boolean }>(`/api/backlog?repo=${encodeURIComponent(repo)}`, {
    method: "PATCH",
    body: JSON.stringify({ path, state, ...(owner ? { owner } : {}) }),
  });
}

function jsonMapOf(raw: string): Record<string, string> | undefined {
  if (!raw.trim()) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  } catch {
    return undefined;
  }
}

/** Contract auth values travel to the Worker only to become sandbox env. */
function authFixtureOf(
  settings: Settings,
): { headers?: Record<string, string>; query?: Record<string, string> } | undefined {
  const headers = jsonMapOf(settings.contractAuthHeaders);
  const query = jsonMapOf(settings.contractAuthQuery);
  return headers || query
    ? { ...(headers ? { headers } : {}), ...(query ? { query } : {}) }
    : undefined;
}

export interface RunsResponse {
  enabled: boolean;
  runs: RunSummary[];
}

/** Run history is optional; `enabled: false` means this deployment has no D1. */
export function fetchRuns(repo: string): Promise<RunsResponse> {
  return apiJson<RunsResponse>(`/api/runs?repo=${encodeURIComponent(repo)}`);
}

export function fetchRunDetail(id: string): Promise<{ enabled: boolean } & RunDetail> {
  return apiJson<{ enabled: boolean } & RunDetail>(`/api/runs/${encodeURIComponent(id)}/files`);
}

export interface Workspace {
  id: string;
  name: string;
  /** Days to keep runs, audit events and command rate-limit rows. */
  retentionDays: number;
  /** Optional workspace-wide drift notification target. */
  driftWebhookUrl?: string;
  /** The secret is write-only; this only says whether one is stored. */
  driftWebhookSecretSet: boolean;
  createdAt: number;
  updatedAt: number;
}

/** One workspace per deployment; `enabled: false` means no RUNS_DB. */
export function fetchWorkspace(): Promise<{
  enabled: boolean;
  workspace?: Workspace;
}> {
  return apiJson<{ enabled: boolean; workspace?: Workspace }>("/api/workspace");
}

export function updateWorkspace(input: {
  name?: string;
  retentionDays?: number;
  driftWebhookUrl?: string;
  driftWebhookSecret?: string;
}): Promise<{ enabled: boolean; workspace: Workspace }> {
  return apiJson<{ enabled: boolean; workspace: Workspace }>("/api/workspace", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export interface AuditEvent {
  id?: number;
  repo?: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: number;
}

/** Newest first. `repo` filters by `owner/name`; the Worker clamps the limit. */
export function fetchAudit(
  repo?: string,
  limit = 100,
): Promise<{ enabled: boolean; events: AuditEvent[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (repo) params.set("repo", repo);
  return apiJson<{ enabled: boolean; events: AuditEvent[] }>(`/api/audit?${params}`);
}

export interface ScheduledRepo {
  repo: string;
  intervalDays: number;
  enabled: boolean;
  installationId?: number;
  lastRunAt?: number;
  driftWebhookUrl?: string;
  driftWebhookSecretSet?: boolean;
}

export function fetchSchedules(): Promise<{
  enabled: boolean;
  schedules: ScheduledRepo[];
}> {
  return apiJson<{ enabled: boolean; schedules: ScheduledRepo[] }>("/api/schedules");
}

/** Upserts one schedule; the response is the full list. */
export function updateSchedule(
  input: ScheduledRepo & { driftWebhookSecret?: string },
): Promise<{ enabled: boolean; schedules: ScheduledRepo[] }> {
  return apiJson<{ enabled: boolean; schedules: ScheduledRepo[] }>("/api/schedules", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteSchedule(repo: string): Promise<{ deleted: boolean }> {
  return apiJson<{ deleted: boolean }>(`/api/schedules?repo=${encodeURIComponent(repo)}`, {
    method: "DELETE",
  });
}

export function fetchMemory(repo: string): Promise<{ enabled: boolean; memory: RepoMemory }> {
  return apiJson<{ enabled: boolean; memory: RepoMemory }>(
    `/api/memory?repo=${encodeURIComponent(repo)}`,
  );
}

export function updateMemory(
  repo: string,
  memory: RepoMemory,
): Promise<{ enabled: boolean; memory: RepoMemory }> {
  return apiJson<{ enabled: boolean; memory: RepoMemory }>(
    `/api/memory?repo=${encodeURIComponent(repo)}`,
    { method: "PUT", body: JSON.stringify({ memory }) },
  );
}

export function deleteMemory(repo: string): Promise<{ deleted: boolean }> {
  return apiJson<{ deleted: boolean }>(`/api/memory?repo=${encodeURIComponent(repo)}`, {
    method: "DELETE",
  });
}

export function fetchPolicy(repo: string): Promise<{ enabled: boolean; policy: PullPolicy }> {
  return apiJson<{ enabled: boolean; policy: PullPolicy }>(
    `/api/policies?repo=${encodeURIComponent(repo)}`,
  );
}

export function updatePolicy(
  repo: string,
  policy: PullPolicy,
): Promise<{ enabled: boolean; policy: PullPolicy }> {
  return apiJson<{ enabled: boolean; policy: PullPolicy }>(
    `/api/policies?repo=${encodeURIComponent(repo)}`,
    { method: "PUT", body: JSON.stringify({ policy }) },
  );
}

export function deletePolicy(repo: string): Promise<{ deleted: boolean }> {
  return apiJson<{ deleted: boolean }>(`/api/policies?repo=${encodeURIComponent(repo)}`, {
    method: "DELETE",
  });
}

/** Stored R2 bundle for one run; the generated source is never included. */
export interface RunArtifact {
  runId: string;
  repo: string;
  ref: string;
  status: string;
  totals?: unknown;
  finishedAt: number;
  files: Array<{
    sourcePath: string;
    testPath: string;
    verified: boolean;
    checks: unknown[];
    coverage?: unknown;
  }>;
}

/** `enabled: false` means no ARTIFACTS binding; a 404 means no bundle for this run. */
export function fetchRunArtifacts(
  id: string,
): Promise<{ enabled: boolean; artifact?: RunArtifact }> {
  return apiJson<{ enabled: boolean; artifact?: RunArtifact }>(
    `/api/runs/${encodeURIComponent(id)}/artifacts`,
  );
}

/** One action deletes every run for the repository. */
export function deleteRuns(repo: string): Promise<{ deleted: number }> {
  return apiJson<{ deleted: number }>(`/api/runs?repo=${encodeURIComponent(repo)}`, {
    method: "DELETE",
  });
}

export function recordRunDecision(
  runId: string,
  sourcePath: string,
  decision: RunDecision,
): Promise<{ updated: number }> {
  return apiJson<{ updated: number }>(`/api/runs/${encodeURIComponent(runId)}/decisions`, {
    method: "POST",
    body: JSON.stringify({ decisions: [{ sourcePath, decision }] }),
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
  /** Re-run only these failed contract operations, not a fresh run. */
  retestOperations?: RetestOperation[],
): Promise<void> {
  const authFixture = authFixtureOf(settings);
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
        concurrency: settings.concurrency,
        maxTokens: settings.maxTokens,
        flakyRuns: settings.flakyRuns,
        mutationCommand: settings.mutationCommand,
        propertyTests: settings.propertyTests,
        autoRouteModels: settings.autoRouteModels,
        ...(authFixture ? { authFixture } : {}),
        strictTypes: settings.strictTypes,
        coverageTarget: settings.coverageTarget,
        mode: "both",
        ...(retryGaps && retryGaps.length > 0 ? { retryGaps } : {}),
        ...(retestOperations && retestOperations.length > 0 ? { retestOperations } : {}),
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
