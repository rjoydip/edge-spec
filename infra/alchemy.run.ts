import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * Cloudflare stack for EdgeSpec.
 *
 * `script` uploads the Vite-built Worker bundle so Alchemy does not introduce
 * a second bundler. `alchemy dev` serves that same bundle locally on the port
 * the dashboard's Vite proxy expects.
 */
const localDev = /^(1|true)$/i.test(process.env.ALCHEMY_DEV ?? "");

/**
 * Cloudflare names allow only lowercase letters, numbers and hyphens, but a
 * stage is free-form (`live_$USER`, `pr_123`). Fold it into a legal slug so a
 * deploy does not fail on an invalid bucket or Worker name.
 */
export function stageSlug(stage: string): string {
  const slug = stage
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return slug || "dev";
}

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
    const slug = stageSlug(stage);

    const db = yield* Cloudflare.D1.Database("EdgeSpecRuns", {
      // Fixed production names are required for adoption; previews get their
      // own database so they can be destroyed without touching real history.
      name: isProd ? "edge-spec-runs" : `edge-spec-runs-${slug}`,
      // Paths are anchored to the repo root so the stack can run from either
      // the root or the `infra/` workspace.
      migrations: fileURLToPath(new URL("../migrations", import.meta.url)),
    });

    const artifacts = yield* Cloudflare.R2.Bucket("EdgeSpecArtifacts", {
      name: isProd ? "edge-spec-artifacts" : `edge-spec-artifacts-${slug}`,
    });

    // Optional values stay secrets. `Config.option` keeps a missing key out of
    // the Worker env instead of turning it into a required deploy input.
    const githubAppId = yield* Config.option(Config.Redacted("GH_APP_ID"));
    const githubAppPrivateKey = yield* Config.option(Config.Redacted("GH_APP_PRIVATE_KEY"));
    const githubWebhookSecret = yield* Config.option(Config.Redacted("GH_WEBHOOK_SECRET"));
    const githubToken = yield* Config.option(Config.Redacted("GH_TOKEN"));
    const driftAlertWebhookUrl = yield* Config.option(Config.Redacted("DRIFT_ALERT_WEBHOOK_URL"));
    const driftAlertWebhookSecret = yield* Config.option(
      Config.Redacted("DRIFT_ALERT_WEBHOOK_SECRET"),
    );

    const worker = yield* Cloudflare.Worker("edge-spec", {
      script: readFileSync(
        fileURLToPath(new URL("../dist/worker/index.js", import.meta.url)),
        "utf8",
      ),
      name: isProd ? "edge-spec" : `edge-spec-${slug}`,
      compatibility: { date: "2025-07-18", flags: ["nodejs_compat"] },
      // Keep the API on the port the dashboard's Vite proxy and docs use.
      dev: { host: "127.0.0.1", port: 8787, strictPort: true },
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
          workflowName: isProd ? "test-generation-workflow" : `test-generation-workflow-${slug}`,
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
        ...(Option.isSome(driftAlertWebhookUrl)
          ? { DRIFT_ALERT_WEBHOOK_URL: driftAlertWebhookUrl.value }
          : {}),
        ...(Option.isSome(driftAlertWebhookSecret)
          ? { DRIFT_ALERT_WEBHOOK_SECRET: driftAlertWebhookSecret.value }
          : {}),
      },
    });

    // Documentation site (VitePress). Cloudflare Pages serves it; Alchemy owns
    // the project, while `bun run docs:deploy` uploads the static build because
    // the Pages REST API has no public asset-upload endpoint.
    //
    // One site, one project: preview and dev stages reuse the published docs.
    // A per-stage Pages project would be empty and its subdomain dead until
    // someone remembered to upload a build.
    const docs = isProd
      ? yield* Cloudflare.Pages.Project("EdgeSpecDocs", {
          name: "edge-spec-docs",
          productionBranch: "main",
        })
      : undefined;

    // Landing page placeholder. When the marketing page exists, build it to a
    // static directory (e.g. `apps/landing/dist`) and either add a second
    // `Cloudflare.Pages.Project` here plus a `wrangler pages deploy` script, or
    // serve it from this docs project with a custom domain and redirects.
    // Nothing is created today, so no unused Pages project is left behind.

    return {
      url: worker.url,
      // The published docs site; preview/dev stages do not own one.
      docsUrl: docs
        ? Output.interpolate`https://${docs.subdomain}`
        : "https://edge-spec-docs.pages.dev",
    };
  }),
);
