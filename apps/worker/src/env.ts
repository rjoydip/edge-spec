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

export interface Env {
  /** Static-assets binding. Typed minimally so DOM and Workers libs don't clash. */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  AI?: AiBinding;
  TEST_GENERATION_WORKFLOW?: WorkflowBinding;
  /** Automation path only. The dashboard always uses the visitor's own token. */
  GITHUB_TOKEN?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  SANDBOX_RUNNER_URL?: string;
  SANDBOX_API_KEY?: string;
}
