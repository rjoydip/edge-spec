import { fileURLToPath } from "node:url";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { stageSlug } from "../shared/stage.ts";

/**
 * Cloudflare stack for EdgeSpec.
 *
 * `main` + `bundle: false` uploads the Vite-built Worker bundle byte-for-byte,
 * so Alchemy does not introduce a second bundler. In dev it also watches that
 * directory: the `vite build --watch` process (`bun run dev:worker`) rebuilds
 * `dist/worker/index.js`, and `alchemy dev` reloads the local Worker.
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
    const slug = stageSlug(stage);

    const db = yield* Cloudflare.D1.Database("EdgeSpecRuns", {
      // Fixed production names are required for adoption; previews get their
      // own database so they can be destroyed without touching real history.
      name: isProd ? "edge-spec-runs" : `edge-spec-runs-${slug}`,
      // Paths are anchored to the repo root so the stack can run from either
      // the root or the `infra/cloudflare/` workspace.
      migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
    });

    const artifacts = yield* Cloudflare.R2.Bucket("EdgeSpecArtifacts", {
      name: isProd ? "edge-spec-artifacts" : `edge-spec-artifacts-${slug}`,
    });

    // Read-through cache for quota/branch lookups. Optional at runtime: an
    // unbound Worker still works, it just skips the cache.
    const cache = yield* Cloudflare.KV.Namespace("EdgeSpecCache", {
      title: isProd ? "edge-spec-cache" : `edge-spec-cache-${slug}`,
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
    // Accounts and observability are optional: unset means "better-auth
    // derives/uses its default secret" and "consola logs".
    const betterAuthSecret = yield* Config.option(Config.Redacted("BETTER_AUTH_SECRET"));
    const emailApiKey = yield* Config.option(Config.Redacted("EMAIL_API_KEY"));
    const sentryDsn = yield* Config.option(Config.Redacted("SENTRY_DSN"));
    const axiomToken = yield* Config.option(Config.Redacted("AXIOM_TOKEN"));
    const otlpEndpoint = yield* Config.option(Config.Redacted("OTEL_EXPORTER_OTLP_ENDPOINT"));
    const otlpHeaders = yield* Config.option(Config.Redacted("OTEL_EXPORTER_OTLP_HEADERS"));

    const worker = yield* Cloudflare.Worker("edge-spec", {
      // Prebuilt source (not an inline `script`): Alchemy watches this file in
      // dev, so a Vite rebuild reloads the Worker without restarting the stack.
      main: fileURLToPath(new URL("../../dist/worker/index.js", import.meta.url)),
      bundle: false,
      name: isProd ? "edge-spec" : `edge-spec-${slug}`,
      compatibility: { date: "2025-07-18", flags: ["nodejs_compat"] },
      // Keep the API on the port the dashboard's Vite proxy and docs use.
      dev: { host: "127.0.0.1", port: 8787, strictPort: true },
      // Previews must never run the daily cron and open PRs from a preview.
      crons: isProd ? ["0 8 * * *"] : [],
      assets: {
        directory: fileURLToPath(new URL("../../dist/web", import.meta.url)),
        notFoundHandling: "single-page-application",
      },
      env: {
        RUNS_DB: db,
        ARTIFACTS: artifacts,
        CACHE: cache,
        TEST_GENERATION_WORKFLOW: Cloudflare.Workflow("TestGenerationWorkflow", {
          className: "TestGenerationWorkflow",
          workflowName: isProd ? "test-generation-workflow" : `test-generation-workflow-${slug}`,
        }),
        AI: Cloudflare.Workers.AI(),
        // Local dev needs a stable origin for Better Auth callbacks.
        ...(localDev ? { BETTER_AUTH_URL: "http://127.0.0.1:8787" } : {}),

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
        ...(Option.isSome(betterAuthSecret) ? { BETTER_AUTH_SECRET: betterAuthSecret.value } : {}),
        ...(Option.isSome(emailApiKey) ? { EMAIL_API_KEY: emailApiKey.value } : {}),
        ...(Option.isSome(sentryDsn) ? { SENTRY_DSN: sentryDsn.value } : {}),
        ...(Option.isSome(axiomToken) ? { AXIOM_TOKEN: axiomToken.value } : {}),
        ...(Option.isSome(otlpEndpoint) ? { OTEL_EXPORTER_OTLP_ENDPOINT: otlpEndpoint.value } : {}),
        ...(Option.isSome(otlpHeaders) ? { OTEL_EXPORTER_OTLP_HEADERS: otlpHeaders.value } : {}),
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

    // Marketing landing page. Same split as the docs: Alchemy owns the Pages
    // project; `bun run www:deploy` uploads the static build because the Pages
    // REST API has no public asset-upload endpoint. Prod-only for the same
    // reason: a preview project would be empty until someone uploaded to it.
    const www = isProd
      ? yield* Cloudflare.Pages.Project("EdgeSpecWww", {
          name: "edge-spec-www",
          productionBranch: "main",
        })
      : undefined;

    return {
      url: worker.url,
      // The published docs site; preview/dev stages do not own one.
      // Local dev does not own a Pages project; `bun run dev:all` serves the
      // docs site at this address.
      docsUrl: localDev
        ? "http://localhost:5174"
        : docs
          ? Output.interpolate`https://${docs.subdomain}`
          : "https://edge-spec-docs.pages.dev",
      // The landing page; `dev-worker` serves it locally on this port.
      wwwUrl: localDev
        ? "http://localhost:5175"
        : www
          ? Output.interpolate`https://${www.subdomain}`
          : "https://edge-spec-www.pages.dev",
    };
  }),
);
