/**
 * Vercel target. Alchemy has no Vercel provider, so the deploy is a
 * `Command.Exec` node: `vercel deploy --prod` runs from the repo root, where
 * `vercel.json` and `api/` must live (Vercel reads both from the Root
 * Directory). The command is memoized on the repo contents, so it only
 * redeploys when something changed.
 *
 * Requires `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.
 */
import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "EdgeSpecVercel",
  {
    providers: Command.providers(),
    // No cloud state provider for Vercel; local state still memoizes the deploy.
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const token = yield* Config.Redacted("VERCEL_TOKEN");
    const orgId = yield* Config.String("VERCEL_ORG_ID");
    const projectId = yield* Config.String("VERCEL_PROJECT_ID");

    const deploy = yield* Command.Exec("vercel-deploy", {
      command: "bunx vercel deploy --prod --yes",
      cwd: "../..",
      env: {
        VERCEL_TOKEN: token,
        VERCEL_ORG_ID: orgId,
        VERCEL_PROJECT_ID: projectId,
      },
      timeout: "20 minutes",
    });

    return { input: deploy.hash.input };
  }),
);
