/**
 * Run artifacts live in R2; D1 keeps the summaries. The bundle holds the
 * validation check output and coverage facts so a finished run can be inspected
 * after the SSE stream is gone. Generated test source is never stored here.
 */
import type { Env } from "./env";

export interface RunArtifact {
  runId: string;
  repo: string;
  ref: string;
  status: string;
  totals: unknown;
  finishedAt: number;
  files: Array<{
    sourcePath: string;
    testPath: string;
    verified: boolean;
    checks: unknown[];
    coverage?: unknown;
  }>;
}

export function runArtifactKey(id: string): string {
  return `runs/${id}.json`;
}

/** Writes the bundle; returns false when the bucket is not bound. */
export async function putRunArtifact(env: Env, artifact: RunArtifact): Promise<boolean> {
  const bucket = env.ARTIFACTS;
  if (!bucket) return false;
  await bucket.put(runArtifactKey(artifact.runId), JSON.stringify(artifact), {
    httpMetadata: { contentType: "application/json" },
  });
  return true;
}

export async function getRunArtifact(env: Env, id: string): Promise<RunArtifact | undefined> {
  const object = await env.ARTIFACTS?.get(runArtifactKey(id));
  if (!object) return undefined;
  try {
    return JSON.parse(await object.text()) as RunArtifact;
  } catch {
    return undefined;
  }
}

/** Deletes the bundles whose D1 rows expired. Returns how many were present. */
export async function deleteRunArtifacts(env: Env, ids: readonly string[]): Promise<number> {
  const bucket = env.ARTIFACTS;
  if (!bucket || ids.length === 0) return 0;
  let deleted = 0;
  for (const id of ids) {
    try {
      await bucket.delete(runArtifactKey(id));
      deleted += 1;
    } catch {
      // A missing object is fine; one failure must not stop the purge.
    }
  }
  return deleted;
}
