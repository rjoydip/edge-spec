import * as Command from "alchemy/Command";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { expect } from "bun:test";
import Stack from "../vercel.run.ts";

/**
 * Opt-in live stack test. The file is deliberately not named `*.test.ts`, so
 * plain `bun test` never runs a deployment.
 *
 *   bun run test:vercel
 *   SKIP_DEPLOY=1 bun run test:vercel
 *
 * Runs the real `vercel deploy --prod` (needs `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
 * `VERCEL_PROJECT_ID`) and checks what the stack returned.
 */
const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: Command.providers(),
});

const deployed = beforeAll(
  process.env.SKIP_DEPLOY
    ? Effect.succeed({ input: process.env.VERCEL_DEPLOY_INPUT ?? "" })
    : deploy(Stack),
  { timeout: 1_500_000 },
);

afterAll.skipIf(Boolean(process.env.SKIP_DEPLOY))(destroy(Stack));

test(
  "records one memoized deploy",
  Effect.gen(function* () {
    const { input } = yield* deployed;
    // Vercel has no hosted state provider: the stack's output is the deploy
    // memoization key, so that is what this test checks.
    expect((input ?? "").length).toBeGreaterThan(0);
  }),
);
