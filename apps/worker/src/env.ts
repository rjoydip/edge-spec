import type { AiBinding } from "@edge-spec/core/ai";

/** Just the parts of a Workflow instance status the dashboard needs. */
export interface WorkflowStatus {
  status: string;
  error?: { message?: string } | null;
  output?: unknown;
  steps?: { name: string; status: string }[];
}

export interface WorkflowInstance {
  id: string;
  status(): Promise<WorkflowStatus>;
}

export interface WorkflowBinding {
  create(options?: { params?: unknown; id?: string }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

/** The subset of D1 this Worker uses, typed without pulling in Workers types. */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
}

/** The subset of R2 used for drift and run artifacts. */
export interface R2Bucket {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<void>;
}

export interface Env {
  /** Static-assets binding. Typed minimally so DOM and Workers libs don't clash. */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Optional artifact bucket for drift summaries. */
  ARTIFACTS?: R2Bucket;
  /** Optional Slack-compatible webhook for drift notifications. */
  DRIFT_WEBHOOK_URL?: string;
  DRIFT_WEBHOOK_SECRET?: string;
  AI?: AiBinding;
  TEST_GENERATION_WORKFLOW?: WorkflowBinding;
  /** Optional run history. Absent on a deployment that does not want it. */
  RUNS_DB?: D1Database;
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
}
