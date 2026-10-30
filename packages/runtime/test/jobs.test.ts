/**
 * Phase 3's guard: the extraction into `jobs.ts` must not rename or reorder the
 * Workflow steps, because Cloudflare replays a run by step name. The fake
 * runner records every name and fails on one the test does not expect.
 */
import { describe, expect, it } from "bun:test";
import type { Env } from "../src/env";
import { runGenerationJob, type StepRunner, type WorkflowParams } from "../src/jobs";

function recordingStep(results: Record<string, unknown>): {
  step: StepRunner;
  names: string[];
} {
  const names: string[] = [];
  return {
    names,
    step: {
      async do<T>(name: string): Promise<T> {
        names.push(name);
        if (!(name in results)) throw new Error(`Unexpected step: ${name}`);
        return results[name] as T;
      },
    },
  };
}

const params: WorkflowParams = {
  repo: "acme/api",
  ref: "main",
  event: "pull_request",
  pullRequest: 7,
  headSha: "abc123",
};

describe("generation job", () => {
  it("keeps the pull-request check steps and their order", async () => {
    const { step, names } = recordingStep({
      "changed-files": ["src/a.ts"],
      "scan-changed": {
        gaps: [],
        affectedTests: [],
        sources: ["src/a.ts"],
        testsBySource: [{ path: "src/a.ts", tests: [] }],
      },
      "impact-graph": { tests: [], partial: false },
      "publish-check": { checkId: 1, commentId: 2 },
    });

    const result = await runGenerationJob(params, step, { GH_TOKEN: "token" } as Env);

    expect(names).toEqual(["changed-files", "scan-changed", "impact-graph", "publish-check"]);
    // Cloudflare replays a run by step name, so two steps may never share one.
    expect(new Set(names).size).toBe(names.length);
    expect(result).toMatchObject({ status: "checked", changed: 1, gaps: 0, executed: false });
  });

  it("refuses to invent a step the run did not plan", async () => {
    const { step } = recordingStep({});

    await expect(runGenerationJob(params, step, { GH_TOKEN: "token" } as Env)).rejects.toThrow(
      "Unexpected step",
    );
  });
});
