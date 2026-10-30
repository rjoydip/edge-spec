/**
 * Railway target. Railway builds a service from a Docker context, so this
 * stack uploads the repo root and lets Railway build `Dockerfile`.
 *
 * Runtime configuration belongs to Railway variables (`railway variables
 * --set ...` or the dashboard). `RAILWAY_API_TOKEN` is only needed in CI.
 */
import * as Railway from "@alchemy.run/railway";
import * as Alchemy from "alchemy";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import { stageSlug } from "../shared/stage.ts";

export default Alchemy.Stack(
  "EdgeSpecRailway",
  {
    // Railway has no remote state store; state stays on the deploying machine.
    state: Alchemy.localState(),
    providers: Railway.providers(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const isProd = stage === "prod";
    const slug = stageSlug(stage);

    const project = yield* Railway.Project("EdgeSpec", {
      name: isProd ? "edge-spec" : `edge-spec-${slug}`,
      description: "EdgeSpec runtime",
    });

    const service = yield* Railway.Service("EdgeSpec", {
      project,
      // Repo root: Railway builds Dockerfile and runs its CMD.
      context: "../..",
      port: 8787,
      env: { EDGESPEC_PROVIDER: "node" },
      healthcheck: "/api/health",
      healthcheckTimeout: 30,
    });

    return { url: service.url, project: project.url };
  }),
);
