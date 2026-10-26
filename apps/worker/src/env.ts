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

export interface Env {
  /** Static-assets binding. Typed minimally so DOM and Workers libs don't clash. */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  AI?: AiBinding;
  TEST_GENERATION_WORKFLOW?: WorkflowBinding;
  /** Optional run history. Absent on a deployment that does not want it. */
  RUNS_DB?: D1Database;
  /** Automation path only. The dashboard always uses the visitor's own token. */
  GITHUB_TOKEN?: string;
  /** GitHub App credentials for CI. Short-lived installation tokens are minted. */
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  SANDBOX_RUNNER_URL?: string;
  SANDBOX_API_KEY?: string;
}
