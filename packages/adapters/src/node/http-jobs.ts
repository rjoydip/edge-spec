/**
 * Job queue over an external runner's HTTP contract:
 *
 *   POST {url}/jobs        { id?, params } -> { id }
 *   GET  {url}/jobs/:id                    -> { status, error?, output?, steps? }
 *
 * The runner owns durability (Vercel Queues, SQS + ECS, Step Functions, or a
 * small Bun service). This adapter only enqueues and polls.
 */
import type { JobInstance, JobQueue, JobStatus } from "@edge-spec/runtime/env";

export interface HttpJobsOptions {
  url: string;
  key?: string;
}

export function httpJobs(options: HttpJobsOptions): JobQueue {
  const base = options.url.replace(/\/+$/, "");
  const headers = {
    "content-type": "application/json",
    ...(options.key ? { authorization: `Bearer ${options.key}` } : {}),
  };

  const status = async (id: string): Promise<JobStatus> => {
    const response = await fetch(`${base}/jobs/${encodeURIComponent(id)}`, { headers });
    if (!response.ok) throw new Error(`Job runner returned ${response.status}.`);
    return (await response.json()) as JobStatus;
  };

  return {
    async create(createOptions?: { params?: unknown; id?: string }): Promise<JobInstance> {
      const response = await fetch(`${base}/jobs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...(createOptions?.id ? { id: createOptions.id } : {}),
          params: createOptions?.params,
        }),
      });
      if (!response.ok) throw new Error(`Job runner returned ${response.status}.`);
      const body = (await response.json()) as { id?: string };
      if (!body.id) throw new Error("Job runner did not return an id.");
      const id = body.id;
      return { id, status: () => status(id) };
    },
    async get(id: string): Promise<JobInstance> {
      return { id, status: () => status(id) };
    },
  };
}
