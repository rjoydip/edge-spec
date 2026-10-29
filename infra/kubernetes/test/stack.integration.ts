import * as Kubernetes from "@alchemy.run/kubernetes";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { expect } from "bun:test";
import Stack from "../kubernetes.run.ts";

/**
 * Opt-in stack test. The file is deliberately not named `*.test.ts`, so plain
 * `bun test` never touches a cluster.
 *
 *   bun run test:kubernetes
 *   SKIP_DEPLOY=1 STACK_URL=https://… bun run test:kubernetes
 *
 * Builds the app image into the cluster (kind locally, `kubeconfig` elsewhere),
 * applies the Deployment/Service and probes it.
 */
const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: Kubernetes.providers(),
});

const deployed = beforeAll(
  process.env.SKIP_DEPLOY
    ? Effect.succeed({
        service: process.env.STACK_SERVICE ?? "",
        url: process.env.STACK_URL ?? "",
      })
    : deploy(Stack),
  { timeout: 1_200_000 },
);

afterAll.skipIf(Boolean(process.env.SKIP_DEPLOY))(destroy(Stack));

test(
  "applies the deployment and serves health",
  Effect.gen(function* () {
    const { service, url } = yield* deployed;
    expect(service.length).toBeGreaterThan(0);

    const health = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${String(url).replace(/\/$/, "")}/api/health`);
        return { status: response.status, body: (await response.json()) as unknown };
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    expect(health.status).toBe(200);
  }),
);
