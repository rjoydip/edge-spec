/**
 * AWS target. The app itself runs on the portable Bun entry (`bun run serve`,
 * a container, or any host); this stack owns the AWS resources it consumes.
 * Today that is the artifact bucket for `EDGESPEC_BLOB=s3`; Postgres, the job
 * runner and cron stay external by design (see `apps/docs/deployment.md` §8).
 */
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

    return {
      bucket: artifacts.bucketName,
      region: artifacts.region,
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
