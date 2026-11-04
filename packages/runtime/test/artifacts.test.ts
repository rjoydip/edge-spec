import { describe, expect, it } from "bun:test";
import {
  deleteRunArtifacts,
  getRunArtifact,
  purgeDriftArtifacts,
  putRunArtifact,
  runArtifactKey,
} from "../src/artifacts";
import type { Env, R2Bucket } from "../src/env";

function fakeBucket() {
  const objects = new Map<string, string>();
  const bucket: R2Bucket = {
    async put(key, value) {
      objects.set(key, value);
    },
    async get(key) {
      const value = objects.get(key);
      return value === undefined ? null : { text: async () => value };
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix));
    },
  };
  return { bucket, objects };
}

const artifact = {
  runId: "run-1",
  repo: "acme/api",
  ref: "main",
  status: "ready",
  totals: { missing: 1, coverage: 0, api: 0, unsupported: 0, skipped: 0 },
  finishedAt: 10,
  files: [
    {
      sourcePath: "src/a.ts",
      testPath: "test/a.test.ts",
      verified: true,
      checks: [{ name: "bun test", ok: true, output: "1 pass" }],
    },
  ],
};

describe("run artifacts", () => {
  it("round-trips a bundle and keys it by run id", async () => {
    const { bucket, objects } = fakeBucket();
    const env = { ARTIFACTS: bucket } as Env;
    expect(await putRunArtifact(env, artifact)).toBe(true);
    expect([...objects.keys()]).toEqual([runArtifactKey("run-1")]);
    expect(await getRunArtifact(env, "run-1")).toEqual(artifact);
  });

  it("reports a missing bucket instead of throwing", async () => {
    const env = {} as Env;
    expect(await putRunArtifact(env, artifact)).toBe(false);
    expect(await getRunArtifact(env, "run-1")).toBeUndefined();
    expect(await deleteRunArtifacts(env, ["run-1"])).toBe(0);
  });

  it("sweeps drift summaries past the retention window", async () => {
    const { bucket, objects } = fakeBucket();
    const now = 10 * 86_400_000;
    await bucket.put(`drift/acme/api/${now - 2 * 86_400_000}.json`, "{}");
    await bucket.put(`drift/acme/api/${now - 60_000}.json`, "{}");
    await bucket.put("runs/run-1.json", "{}");

    expect(await purgeDriftArtifacts({ ARTIFACTS: bucket } as Env, 1, now)).toBe(1);
    expect([...objects.keys()]).toEqual([`drift/acme/api/${now - 60_000}.json`, "runs/run-1.json"]);
  });

  it("ignores an unreadable bundle and deletes expired ids", async () => {
    const { bucket, objects } = fakeBucket();
    await bucket.put(runArtifactKey("run-2"), "not json");
    const env = { ARTIFACTS: bucket } as Env;
    expect(await getRunArtifact(env, "run-2")).toBeUndefined();

    await putRunArtifact(env, artifact);
    expect(await deleteRunArtifacts(env, ["run-1", "run-2"])).toBe(2);
    expect(objects.size).toBe(0);
  });
});
