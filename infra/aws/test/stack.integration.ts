import * as AWS from "@alchemy.run/aws";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { expect } from "bun:test";
import Stack from "../aws.run.ts";

/**
 * Opt-in live stack test. The file is deliberately not named `*.test.ts`, so
 * plain `bun test` never provisions cloud resources.
 *
 *   bun run test:aws
 *   SKIP_DEPLOY=1 ARCHIVE_URL=… bun run test:aws
 *
 * Provisions the real S3 artifact bucket and checks what the stack returns.
 * No app is deployed here: the AWS target owns artifacts only — Postgres, the
 * job runner and cron stay external (see deployment.md §8).
 */
const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: AWS.providers(),
});

const deployed = beforeAll(
  process.env.SKIP_DEPLOY
    ? Effect.succeed({
        bucket: process.env.STACK_BUCKET ?? "",
        region: process.env.STACK_REGION ?? "",
      })
    : deploy(Stack),
  { timeout: 600_000 },
);

afterAll.skipIf(Boolean(process.env.SKIP_DEPLOY))(destroy(Stack));

test(
  "provisions the artifact bucket",
  Effect.gen(function* () {
    const { bucket, region } = yield* deployed;
    expect(bucket.length).toBeGreaterThan(0);
    expect(region.length).toBeGreaterThan(0);
  }),
);
