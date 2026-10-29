import * as Railway from "@alchemy.run/railway";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { expect } from "bun:test";
import Stack from "../railway.run.ts";

/**
 * Opt-in live stack test. The file is deliberately not named `*.test.ts`, so
 * plain `bun test` never provisions cloud resources.
 *
 *   bun run test:railway
 *   SKIP_DEPLOY=1 STACK_URL=https://… bun run test:railway
 *
 * Builds the root Dockerfile, starts a Railway service and probes it — needs
 * the Railway credentials the stack declares.
 */
const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: Railway.providers(),
});

const deployed = beforeAll(
  process.env.SKIP_DEPLOY
    ? Effect.succeed({
        url: process.env.STACK_URL ?? "",
        project: process.env.STACK_PROJECT ?? "",
      })
    : deploy(Stack),
  { timeout: 1_200_000 },
);

afterAll.skipIf(Boolean(process.env.SKIP_DEPLOY))(destroy(Stack));

test(
  "starts the service and serves health",
  Effect.gen(function* () {
    const { url, project } = yield* deployed;
    expect(project.length).toBeGreaterThan(0);
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
