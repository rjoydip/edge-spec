/**
 * Run artifacts live in R2; D1 keeps the summaries. The bundle holds the
 * validation check output and coverage facts so a finished run can be inspected
 * after the SSE stream is gone. Generated test source is never stored here.
 */
import type { Env } from "./env";
import { artifactsStore } from "./platform";

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
    /** Raw JUnit/LCOV from the runner, when it produced them. */
    reports?: { junit?: string; lcov?: string };
  }>;
}

export function runArtifactKey(id: string): string {
  return `runs/${id}.json`;
}

/** Writes the bundle; returns false when the bucket is not bound. */
export async function putRunArtifact(env: Env, artifact: RunArtifact): Promise<boolean> {
  const bucket = artifactsStore(env);
  if (!bucket) return false;
  await bucket.put(runArtifactKey(artifact.runId), JSON.stringify(artifact), {
    httpMetadata: { contentType: "application/json" },
  });
  return true;
}

export async function getRunArtifact(env: Env, id: string): Promise<RunArtifact | undefined> {
  const object = await artifactsStore(env)?.get(runArtifactKey(id));
  if (!object) return undefined;
  try {
    return JSON.parse(await object.text()) as RunArtifact;
  } catch {
    return undefined;
  }
}

const DRIFT_KEY = /^drift\/.+\/(\d+)\.json$/;

/**
 * Deletes drift summaries past the retention window. Drift objects have no D1
 * row to age out, so the key's timestamp is the only clock.
 */
export async function purgeDriftArtifacts(
  env: Env,
  retentionDays: number,
  now = Date.now(),
): Promise<number> {
  const bucket = artifactsStore(env);
  if (!bucket?.list) return 0;
  const cutoff = now - Math.max(1, Math.round(retentionDays)) * 86_400_000;
  let deleted = 0;
  for (const key of await bucket.list("drift/")) {
    const timestamp = Number(DRIFT_KEY.exec(key)?.[1]);
    if (!Number.isFinite(timestamp) || timestamp >= cutoff) continue;
    try {
      await bucket.delete(key);
      deleted += 1;
    } catch {
      // A missing object is fine; one failure must not stop the purge.
    }
  }
  return deleted;
}

/** Deletes the bundles whose D1 rows expired. Returns how many were present. */
export async function deleteRunArtifacts(env: Env, ids: readonly string[]): Promise<number> {
  const bucket = artifactsStore(env);
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
