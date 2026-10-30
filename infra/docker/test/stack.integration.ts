import * as Docker from "@alchemy.run/docker";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { expect } from "bun:test";
import Stack from "../docker.run.ts";

/**
 * Opt-in local stack test. The file is deliberately not named `*.test.ts`, so
 * plain `bun test` never runs a container.
 *
 *   bun run test:docker
 *   SKIP_DEPLOY=1 STACK_URL=http://127.0.0.1:8787 bun run test:docker
 *
 * Builds the root Dockerfile into a local container and probes it. Docker
 * itself is the only credential the Docker target needs.
 */
const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: Docker.providers(),
});

const deployed = beforeAll(
  process.env.SKIP_DEPLOY
    ? Effect.succeed({
        url: process.env.STACK_URL ?? "http://127.0.0.1:8787",
        container: process.env.STACK_CONTAINER ?? "",
      })
    : deploy(Stack),
  { timeout: 600_000 },
);

afterAll.skipIf(Boolean(process.env.SKIP_DEPLOY))(destroy(Stack));

test(
  "runs the container and serves health",
  Effect.gen(function* () {
    const { url, container } = yield* deployed;
    expect(String(url)).toBe("http://127.0.0.1:8787");
    expect(container.length).toBeGreaterThan(0);

    const health = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${url}/api/health`);
        return { status: response.status, body: (await response.json()) as unknown };
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    expect(health.status).toBe(200);
  }),
);
