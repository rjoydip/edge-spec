import type { AiBinding } from "@edge-spec/core/ai";

/** Just the parts of a job status the dashboard needs. */
export interface JobStatus {
  status: string;
  error?: { message?: string } | null;
  output?: unknown;
  steps?: { name: string; status: string }[];
}

export interface JobInstance {
  id: string;
  status(): Promise<JobStatus>;
}

export interface JobQueue {
  create(options?: { params?: unknown; id?: string }): Promise<JobInstance>;
  get(id: string): Promise<JobInstance>;
}

/** The subset of SQL this Worker uses. Backed by D1, Postgres or SQLite. */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
  batch<T = unknown>(statements: SqlStatement[]): Promise<T[]>;
}

/** The subset of object storage used for drift and run artifacts. */
export interface ObjectStore {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<void>;
}

/** Optional read-through cache. Never the source of truth. */
export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export type CacheDriver = "kv" | "redis" | "memory";

export interface Env {
  /** Static-assets binding. Absent when the host serves the bundle itself. */
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  /** Optional artifact bucket for drift summaries and run bundles. */
  BLOB?: ObjectStore;
  /** @deprecated use BLOB */
  ARTIFACTS?: ObjectStore;
  /** Optional run history. Absent on a deployment that does not want it. */
  DB?: SqlDatabase;
  /** @deprecated use DB */
  RUNS_DB?: SqlDatabase;
  /** Optional durable jobs. Absent means webhook automation is unavailable. */
  JOBS?: JobQueue;
  /** @deprecated use JOBS */
  TEST_GENERATION_WORKFLOW?: JobQueue;
  /** "true" when JOBS replays after a crash. */
  JOBS_DURABLE?: string;
  /** Optional read-through cache. */
  CACHE?: CacheStore;
  CACHE_DRIVER?: CacheDriver;
  /** Guards POST /api/cron/tick. Absent disables the route. */
  CRON_SECRET?: string;
  /** Optional Slack-compatible webhook for drift notifications. */
  DRIFT_ALERT_WEBHOOK_URL?: string;
  DRIFT_ALERT_WEBHOOK_SECRET?: string;
  /** Workers AI binding, or provider config for the automation path. */
  AI?: AiBinding;
  AI_PROVIDER?: string;
  AI_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  /** Automation path only. The dashboard always uses the visitor's own token. */
  GH_TOKEN?: string;
  /** GitHub App credentials for CI. Short-lived installation tokens are minted. */
  GH_APP_ID?: string;
  GH_APP_PRIVATE_KEY?: string;
  GH_WEBHOOK_SECRET?: string;
  /**
   * Optional deployment fallback for automation runs. Interactive requests
   * normally supply the runner through `x-sandbox-url` / `x-sandbox-key`.
   */
  SANDBOX_RUNNER_URL?: string;
  SANDBOX_API_KEY?: string;
  /** Email sender fallback (Resend). Requests normally carry it as a header. */
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Manual plan activation endpoint guard. Absent disables it. */
  ADMIN_KEY?: string;
  /** The public origin used in emails; defaults to the request origin. */
  EDGESPEC_WORKSPACE_URL?: string;
}

/** @deprecated use SqlStatement */
export type D1PreparedStatement = SqlStatement;
/** @deprecated use SqlDatabase */
export type D1Database = SqlDatabase;
/** @deprecated use ObjectStore */
export type R2Bucket = ObjectStore;
/** @deprecated use JobQueue */
export type WorkflowBinding = JobQueue;
/** @deprecated use JobStatus */
export type WorkflowStatus = JobStatus;
/** @deprecated use JobInstance */
export type WorkflowInstance = JobInstance;
