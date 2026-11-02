/**
 * AWS target. The Lambda function runs the shared Hono app through
 * `lambda.ts` (Function URL → Request → app → Response). This stack owns the
 * function and the artifact bucket for `EDGESPEC_BLOB=s3`; Postgres, the job
 * runner and cron stay external by design (see `apps/docs/deployment.md` §8).
 */
import { fileURLToPath } from "node:url";
import * as AWS from "@alchemy.run/aws";
import * as Alchemy from "alchemy";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import { stageSlug } from "../shared/stage.ts";

export default Alchemy.Stack(
  "EdgeSpecAws",
  {
    providers: AWS.providers(),
    state: AWS.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const isProd = stage === "prod";
    const slug = stageSlug(stage);

    // Fixed production name for adoption; previews get their own bucket.
    const artifacts = yield* AWS.S3.Bucket("EdgeSpecArtifacts", {
      bucketName: isProd ? "edge-spec-artifacts" : `edge-spec-artifacts-${slug}`,
      versioning: "Enabled",
      encryption: { sseAlgorithm: "AES256" },
      publicAccessBlock: {
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: true,
        restrictPublicBuckets: true,
      },
    });

    // Lambda + public Function URL. `main` is bundled by Alchemy; everything
    // provider-neutral comes from packages, so this is the deployed app.
    const api = yield* AWS.Lambda.Function("EdgeSpecApi", {
      functionName: isProd ? "edge-spec" : `edge-spec-${slug}`,
      main: fileURLToPath(new URL("lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: "nodejs22.x",
      functionUrl: true,
      memorySize: 512,
      env: {
        EDGESPEC_PROVIDER: "aws",
        EDGESPEC_BLOB: "s3",
        EDGESPEC_BLOB_BUCKET: artifacts.bucketName,
        EDGESPEC_BLOB_REGION: artifacts.region,
      },
    });

    return {
      bucket: artifacts.bucketName,
      region: artifacts.region,
      url: api.functionUrl,
      // Copy into the deployment's env; credentials stay deployment-level.
      env: {
        EDGESPEC_PROVIDER: "aws",
        EDGESPEC_BLOB: "s3",
        EDGESPEC_BLOB_BUCKET: artifacts.bucketName,
        EDGESPEC_BLOB_REGION: artifacts.region,
      },
    };
  }),
);
