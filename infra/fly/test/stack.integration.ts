import * as Fly from "@alchemy.run/fly";
import * as Docker from "@alchemy.run/docker";
import * as Layer from "effect/Layer";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { expect } from "bun:test";
import Stack from "../fly.run.ts";

/**
 * Opt-in live stack test. The file is deliberately not named `*.test.ts`, so
 * plain `bun test` never provisions cloud resources.
 *
 *   bun run test:fly
 *   SKIP_DEPLOY=1 STACK_URL=https://… bun run test:fly
 *
 * Builds the root Dockerfile, pushes it to the Fly registry, starts the machine
 * and probes it — needs `FLY_API_TOKEN` and Docker.
 */
const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: Layer.merge(Fly.providers(), Docker.providers()),
});

const deployed = beforeAll(
  process.env.SKIP_DEPLOY
    ? Effect.succeed({
        url: process.env.STACK_URL ?? "",
        machine: process.env.STACK_MACHINE ?? "",
      })
    : deploy(Stack),
  { timeout: 1_200_000 },
);

afterAll.skipIf(Boolean(process.env.SKIP_DEPLOY))(destroy(Stack));

test(
  "deploys the machine and serves health",
  Effect.gen(function* () {
    const { url, machine } = yield* deployed;
    expect(machine.length).toBeGreaterThan(0);
    expect(String(url).startsWith("https://")).toBe(true);

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
