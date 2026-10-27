import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * Cloudflare stack for EdgeSpec.
 *
 * Wrangler stays authoritative until the staging and production parity checks
 * pass. `script` uploads the Vite-built Worker bundle so Alchemy does not
 * introduce a second bundler.
 */
const localDev = /^(1|true)$/i.test(process.env.ALCHEMY_DEV ?? "");

export default Alchemy.Stack(
  "EdgeSpec",
  {
    providers: Cloudflare.providers(),
    // Local emulators must not require a Cloudflare profile just to read state.
    state: localDev ? Alchemy.localState() : Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const isProd = stage === "prod";

    const db = yield* Cloudflare.D1.Database("EdgeSpecRuns", {
      // Fixed production names are required for adoption; previews get their
      // own database so they can be destroyed without touching real history.
      name: isProd ? "edge-spec-runs" : `edge-spec-runs-${stage}`,
      // Paths are anchored to the repo root so the stack can run from either
      // the root or the `alchemy/` workspace.
      migrations: fileURLToPath(new URL("../migrations", import.meta.url)),
    });

    const artifacts = yield* Cloudflare.R2.Bucket("EdgeSpecArtifacts", {
      name: isProd ? "edge-spec-artifacts" : `edge-spec-artifacts-${stage}`,
    });

    // Optional values stay secrets. `Config.option` keeps a missing key out of
    // the Worker env instead of turning it into a required deploy input.
    const githubAppId = yield* Config.option(Config.Redacted("GH_APP_ID"));
    const githubAppPrivateKey = yield* Config.option(Config.Redacted("GH_APP_PRIVATE_KEY"));
    const githubWebhookSecret = yield* Config.option(Config.Redacted("GH_WEBHOOK_SECRET"));
    const githubToken = yield* Config.option(Config.Redacted("GH_TOKEN"));
    const driftWebhookUrl = yield* Config.option(Config.Redacted("DRIFT_WEBHOOK_URL"));
    const driftWebhookSecret = yield* Config.option(Config.Redacted("DRIFT_WEBHOOK_SECRET"));

    const worker = yield* Cloudflare.Worker("edge-spec", {
      script: readFileSync(
        fileURLToPath(new URL("../dist/worker/index.js", import.meta.url)),
        "utf8",
      ),
      name: isProd ? "edge-spec" : `edge-spec-${stage}`,
      compatibility: { date: "2025-07-18", flags: ["nodejs_compat"] },
      // Previews must never run the daily cron and open PRs from a preview.
      crons: isProd ? ["0 8 * * *"] : [],
      assets: {
        directory: fileURLToPath(new URL("../dist/web", import.meta.url)),
        notFoundHandling: "single-page-application",
      },
      env: {
        RUNS_DB: db,
        ARTIFACTS: artifacts,
        TEST_GENERATION_WORKFLOW: Cloudflare.Workflow("TestGenerationWorkflow", {
          className: "TestGenerationWorkflow",
          workflowName: isProd ? "test-generation-workflow" : `test-generation-workflow-${stage}`,
        }),
        AI: Cloudflare.Workers.AI(),

        // Automation credentials are production-only. Preview deployments use
        // the visitor's per-request GitHub token.
        ...(isProd && Option.isSome(githubAppId) ? { GH_APP_ID: githubAppId.value } : {}),
        ...(isProd && Option.isSome(githubAppPrivateKey)
          ? { GH_APP_PRIVATE_KEY: githubAppPrivateKey.value }
          : {}),
        ...(isProd && Option.isSome(githubWebhookSecret)
          ? { GH_WEBHOOK_SECRET: githubWebhookSecret.value }
          : {}),
        ...(isProd && Option.isSome(githubToken) ? { GH_TOKEN: githubToken.value } : {}),
        ...(Option.isSome(driftWebhookUrl) ? { DRIFT_WEBHOOK_URL: driftWebhookUrl.value } : {}),
        ...(Option.isSome(driftWebhookSecret)
          ? { DRIFT_WEBHOOK_SECRET: driftWebhookSecret.value }
          : {}),
      },
    });

    return { url: worker.url };
  }),
);
