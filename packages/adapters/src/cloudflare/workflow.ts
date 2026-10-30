/**
 * Cloudflare Workflows adapter. The orchestration lives in `jobs.ts` so the
 * same job can run on any host that provides a step runner.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "@edge-spec/runtime/env";
import { runGenerationJob, type WorkflowParams } from "@edge-spec/runtime/jobs";

export type { WorkflowParams };

export class TestGenerationWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
    return runGenerationJob(event.payload, step, this.env);
  }
}
