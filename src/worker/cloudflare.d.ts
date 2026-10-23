/**
 * Minimal local declaration of the Workers runtime module.
 *
 * The DOM lib and @cloudflare/workers-types disagree about `Request`, so pulling
 * the whole Workers typings into this project costs more than it earns. Only the
 * three names the Workflow uses are declared here.
 */
declare module "cloudflare:workers" {
  export interface WorkflowStepConfig {
    retries?: {
      limit: number;
      delay: string;
      backoff?: "constant" | "linear" | "exponential";
    };
    timeout?: string;
  }

  export interface WorkflowStep {
    do<T>(name: string, callback: () => Promise<T>, config?: WorkflowStepConfig): Promise<T>;
  }

  export interface WorkflowEvent<T> {
    payload: T;
    timestamp: Date;
    instanceId: string;
  }

  export class WorkflowEntrypoint<Env, Params> {
    readonly env: Env;
    readonly ctx: unknown;
    constructor(ctx: unknown, env: Env);
  }
}
