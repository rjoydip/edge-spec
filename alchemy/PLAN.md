# Alchemy on Cloudflare — migration plan

Branch: `feat/alchemy-cloudflare`, cut from `feat/agentic-test-platform` at
`606e09f`.

Status: Phase 1 implemented. `wrangler.toml`, the Worker, and the deploy path are
unchanged. All Alchemy-specific files live under `alchemy/`.

Implementation notes (2026-10-27):

- `alchemy/package.json` (`@edge-spec/alchemy`) owns the Alchemy dependencies
  and scripts; the root workspace only keeps thin proxy commands.
- `alchemy/alchemy.run.ts`, `alchemy/test/stack.integration.ts`, and
  `alchemy/tsconfig.json` are in place. Build, migrations, and asset paths are
  anchored to the repository root so commands work from either cwd.
- `bun run typecheck`, `bun run build`, `bun test`, `bun run lint`, and targeted
  formatting pass.
- `bun alchemy plan --stage spike --no-input`
  loads the stack and stops only because `profile 'default'` has no Cloudflare
  credentials. Phase 0 deployment checks remain blocked on that profile.
- `ALCHEMY_DEV=1 bun test ./alchemy/test/stack.integration.ts` passes against
  local providers: Worker starts, Workflow binds, health/catalog/SPA assertions
  pass, and the local stack tears down. The test falls back to local state in
  dev so no Cloudflare profile is needed.
- `.github/workflows/deploy.yml` now deploys with
  `bun alchemy deploy --stage prod --yes`. The first production run must add
  `--adopt` to import the existing Worker, D1, R2, and Workflow into state.
- The root `alchemy` script uses `bunx alchemy`; `bun alchemy` in a script named
  `alchemy` resolves to itself and recurses.

Goal: replace hand-written `wrangler.toml` + `wrangler deploy` with an Alchemy
stack for Cloudflare, without rewriting the Worker. AWS, Fly, Railway, Docker,
and Kubernetes are later ports, not part of this migration.

## 1. What exists today

```text
bun run build      Vite → dist/web (SPA) + dist/worker/index.js (Hono bundle)
bun run deploy     wrangler deploy --config wrangler.toml
```

`wrangler.toml` is the source of truth for:

| Concern       | Current value                                             |
| ------------- | --------------------------------------------------------- |
| Entry         | `dist/worker/index.js`                                    |
| Compatibility | `2025-07-18`, `nodejs_compat`                             |
| Assets        | `dist/web`, binding `ASSETS`, SPA fallback                |
| Cron          | `0 8 * * *` → exported `scheduled`                        |
| Workers AI    | binding `AI`                                              |
| Workflow      | `TestGenerationWorkflow` → `TEST_GENERATION_WORKFLOW`     |
| D1            | `edge-spec-runs` → `RUNS_DB`, migrations in `migrations/` |
| R2            | `edge-spec-artifacts` → `ARTIFACTS`                       |
| Secrets       | `wrangler secret put …`                                   |

The Worker exports a plain async handler and the Workflow class:

```ts
export default { fetch: app.fetch, scheduled: runScheduled };
export { TestGenerationWorkflow } from "./workflow";
```

Alchemy supports this async-Worker shape. **Do not rewrite `apps/worker` as an
Effect program.** Effect is a deploy-time dependency of Alchemy, not a runtime
requirement for the Worker.

## 2. Target layout

```text
alchemy/
├── PLAN.md                  # this file
├── alchemy.run.ts           # Cloudflare stack
├── tsconfig.json            # typecheck for the stack and live test
├── aws.run.ts               # later, separate stack
├── github.ts                # optional credentials-as-code stack
└── test/
    └── stack.integration.ts # opt-in live stack test
```

Alchemy has its own workspace package, `@edge-spec/alchemy`. Root scripts
proxy into it, so Alchemy runs with `alchemy/` as its cwd and uses the default
`alchemy/alchemy.run.ts`:

```bash
bun run build
bun alchemy deploy --stage prod
```

Why one stack for the monorepo (Alchemy “Option A”): the dashboard is not a
separate deployment. It is `dist/web` assets on the same Worker, so there is no
cross-stack URL reference to model. A second stack would add state and deploy
ordering without buying anything.

`apps/docs` is also in this workspace but is not deployed today (`docs:build`
only runs in CI). If it should be hosted on Cloudflare later, add one
assets-only Worker to the same stack:

```ts
const Docs = Cloudflare.Worker("edge-spec-docs", {
  assets: { directory: "./apps/docs/.vitepress/dist" },
});
```

If it later needs an independent lifecycle, use `alchemy/docs.run.ts`. Keep
Alchemy files out of `apps/docs/`.

## 3. Stack sketch

Keep Vite as the bundler. Alchemy owns infrastructure and upload, not the
application build.

```ts
import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { readFileSync } from "node:fs";

export default Alchemy.Stack(
  "EdgeSpec",
  {
    providers: Cloudflare.providers(),
    state: localDev ? Alchemy.localState() : Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const isProd = stage === "prod";

    const db = yield* Cloudflare.D1.Database("EdgeSpecRuns", {
      // Production adoption depends on the exact existing physical name.
      name: isProd ? "edge-spec-runs" : `edge-spec-runs-${stage}`,
      migrations: "./migrations",
    });

    const artifacts = yield* Cloudflare.R2.Bucket("EdgeSpecArtifacts", {
      name: isProd ? "edge-spec-artifacts" : `edge-spec-artifacts-${stage}`,
    });

    const worker = yield* Cloudflare.Worker("edge-spec", {
      // Upload the existing Vite bundle. `main` would make Alchemy bundle the
      // source again; keep one bundler until the spike proves otherwise.
      script: readFileSync("./dist/worker/index.js", "utf8"),
      name: isProd ? "edge-spec" : `edge-spec-${stage}`,
      compatibility: { date: "2025-07-18", flags: ["nodejs_compat"] },
      // A preview must never run the daily cron and open PRs from a preview.
      crons: isProd ? ["0 8 * * *"] : [],
      assets: {
        directory: "./dist/web",
        notFoundHandling: "single-page-application",
      },
      env: {
        RUNS_DB: db,
        ARTIFACTS: artifacts,
        TEST_GENERATION_WORKFLOW: Cloudflare.Workflow("TestGenerationWorkflow", {
          className: "TestGenerationWorkflow",
        }),
        AI: Cloudflare.Workers.AI(),
        // Automation credentials are prod-only. Previews use the visitor's
        // per-request PAT and must not be able to open PRs or receive webhooks.
        ...(isProd
          ? {
              GH_APP_ID: Config.Redacted("GH_APP_ID"),
              GH_APP_PRIVATE_KEY: Config.Redacted("GH_APP_PRIVATE_KEY"),
              GH_WEBHOOK_SECRET: Config.Redacted("GH_WEBHOOK_SECRET"),
              GH_TOKEN: Config.Redacted("GH_TOKEN"),
            }
          : {}),
        // Optional DRIFT_* values: resolve with Config.option and spread only
        // when present. Never make these required deploy input.
      },
    });

    return { url: worker.url };
  }),
);
```

Notes:

- `apps/worker/src/env.ts` stays the Worker's own `Env` type. Importing the
  Alchemy stack into Worker source is not needed and risks pulling Effect into
  the bundle.
- `ASSETS` is used by the SPA fallback (`app.all("*", … env.ASSETS.fetch)`).
  Alchemy creates it when `assets` is set; confirm this in the spike.
- D1/R2 adoption depends on the explicit physical names above. Logical ids
  alone are not enough.
- Pin exact versions after the spike; Alchemy is still beta.
- `script` with the prebuilt bundle still needs a spike because the Workflow
  export must survive Vite bundling and be discoverable by Alchemy.

## 4. Phases

### Phase 0 — spike, disposable account

Timebox: half a day. Use a scratch stage. Do not touch production.

1. Install and pin the toolchain:

   ```bash
   bun add --dev alchemy@2.0.0-beta.84 @alchemy.run/cloudflare@2.0.0-beta.84 \
     effect@4.0.6 @effect/platform-bun@4.0.6 @effect/platform-node@4.0.6
   ```

   A local spike confirmed this install and `bun alchemy --help` work.

2. Confirm `Cloudflare.Workers.AI()` maps to the native `AI` binding.
3. Confirm `assets` creates `ASSETS`, serves assets first, and applies the SPA
   fallback.
4. Confirm `compatibility: { date, flags }` is the correct Worker prop.
5. Confirm `Cloudflare.Workflow(..., { className })` binds the Workflow class
   exported from the prebuilt `dist/worker/index.js`.
6. Confirm `crons: []` removes cron triggers for preview stages.
7. Confirm the prebuilt `script` upload works with Workflows and `nodejs_compat`.
8. Confirm D1/R2 adoption:
   - explicit names match `edge-spec-runs` / `edge-spec-artifacts`;
   - `--adopt` imports existing resources instead of failing;
   - Alchemy adopts Wrangler’s D1 migration history in
     `__alchemy_migrations`.
9. Verify a token with Workers Scripts, D1, and R2 write access can deploy
   non-interactively with `--yes`.
10. Capture the deployed Worker URL from plain-mode output for PR comments.
11. Smoke `/api/health`, `/api/catalog`, `/`, and one Workflow instance.

Exit: findings appended here. If AI, D1 adoption, Workflow binding, or the
prebuilt bundle fail, stop and keep Wrangler.

#### Connect the default Cloudflare profile

A Wrangler login is not an Alchemy credential. Alchemy keeps its own profile at
`~/.alchemy` and currently reports `Provider 'Cloudflare' is not configured`.

OAuth (easiest; choose **All Scopes** so R2 is included):

```bash
bun alchemy profile edit --profile default --add Cloudflare
```

API token (non-interactive):

```bash
export CLOUDFLARE_API_TOKEN=…
export CLOUDFLARE_ACCOUNT_ID=…
bun alchemy profile edit --profile default --add Cloudflare --method stored \
  --set apiToken=env:CLOUDFLARE_API_TOKEN \
  --set accountId=env:CLOUDFLARE_ACCOUNT_ID
```

The token needs at least Workers Scripts, Workers KV, D1, R2, and Workers AI
permissions for this stack. Verify with:

```bash
bun alchemy profile show
bun alchemy plan --stage spike --no-input
```

For a disposable account: use a second Cloudflare account for the spike. If
using the main account, `--stage spike` is still isolated (`edge-spec-spike`,
`edge-spec-runs-spike`, `edge-spec-artifacts-spike`); production names are only
used for `stage === "prod"`. Run `bun alchemy destroy --stage spike --yes`
afterward.

### Phase 1 — add the stack, Wrangler still authoritative

- Add `alchemy/alchemy.run.ts` with the four resources and env above.
- Add `alchemy/test/stack.integration.ts` (Phase 2 details).
- `alchemy/package.json` owns the Alchemy dependencies and scripts.
- Root scripts proxy into that workspace:
  - `"alchemy": "bun run --cwd alchemy alchemy"`
  - `"deploy:stage": "bun run build && bun run --cwd alchemy deploy --stage"`
  - `"test:stack": "bun run build && bun run --cwd alchemy test"`
  - leave `"deploy"` on Wrangler until Phase 3.
- Ignore generated state: `.alchemy/` and `alchemy/.alchemy/`.
- Keep `wrangler.toml` untouched.
- `bun run typecheck` and `bun run build` must stay green.

Exit: `bun alchemy plan --stage spike` shows the expected creates and no
unexpected replacements.

### Phase 2 — staging parity

```bash
bun run build
bun alchemy deploy --stage staging
```

Smoke matrix:

- `GET /api/health`, `/api/catalog`, `/api/quota`
- dashboard root and a deep link
- `/api/scan` against a public fixture repo
- `/webhook` rejects a bad signature
- D1 write + read (`/api/runs` / history)
- R2 artifact write when a run produces artifacts
- Workflow create + poll `/api/runs/:id`
- `scheduled` path through `alchemy dev` or a staging cron

Add the live stack test:

- `alchemy/test/stack.integration.ts`, named without `.test` so `bun test` does
  not deploy a cloud stack.
- `import Stack from "../alchemy.run.ts"`.
- `Test.make({ providers: Cloudflare.providers(), state: Cloudflare.state() })`
  from `alchemy/Test/Bun`.
- `beforeAll(deploy(Stack))`, `afterAll(destroy(Stack))`; raise the first-deploy
  hook timeout to ~300s.
- Assert `/api/health` is 200 JSON, `/api/catalog` lists providers, and `/`
  returns the SPA shell.
- `ALCHEMY_DEV=1 bun run test:stack` exercises emulators.
- `SKIP_DEPLOY=1 STACK_URL=… bun run test:stack` hits an existing stage.

Then `bun alchemy destroy --stage staging` and
verify no orphan D1/R2 resources.

Exit: parity is green and the Worker source still needs no changes.

### Phase 3 — production cutover

Decision: **migrate D1, do not reset.** It holds policies, memory, backlog,
schedules, and audit history. Adopt first; export/import is the fallback.

1. Adopt existing D1/R2 with explicit names and `--adopt` if needed.
2. If adoption fails:
   - `wrangler d1 export edge-spec-runs --remote --output runs.sql`
   - create the Alchemy DB and import the dump;
   - copy R2 objects or accept empty artifacts (they are disposable).
   - use a quiet window: in-flight Workflow instances do not move.

Then:

- Deploy once locally:
  `bun alchemy deploy --stage prod`.
- Update `.github/workflows/deploy.yml`:
  `bun run build && bun alchemy deploy --stage prod --yes`.
- Keep `wrangler.toml` and the old deployment as rollback for at least one
  release.
- Confirm the Worker name stays `edge-spec` so the `*.workers.dev` URL and the
  GitHub webhook URL do not change.
- Verify a webhook round trip and D1 history.

### Phase 4 — remove Wrangler, after at least a week green

- Delete `wrangler.toml`.
- Repoint root `deploy` and `dev:worker` at
  `bun alchemy ...`; drop `db:migrate*`
  (migrations run during deploy).
- Remove `wrangler` from root and `apps/worker` dev dependencies.
- Update `apps/docs/deployment.md`, `apps/worker/README.md`, and `AGENTS.md`.
- Update `scripts/dev.ts` only if the dev command changes.
- Run `bun run check`, `bun run build`, and `bun run docs:build`.

`alchemy dev` replaces `wrangler dev` only after the staging parity check. If
D1/R2/AI emulation is weaker, keep Wrangler dev longer; deployment can still
move.

### Phase 5 — later providers

Do not abstract now. Add `alchemy/aws.run.ts` with its own state/stage only
when AWS is actually needed. Cloudflare-first is deliberate: the Worker uses
Cloudflare-only primitives (`Workflows`, `D1`, `R2`, `AI`, `ASSETS`).

Porting to AWS/Fly/Railway/Docker/K8s is not a config swap. It needs adapters:

- compute: container running the Hono app on Bun/Node
- D1 → Postgres (adapter behind `db.ts`)
- R2 → S3 (same subset already typed in `env.ts`)
- Workflows → queue/worker or Temporal
- AI → provider HTTP APIs (already in `packages/core/src/ai.ts`)
- ASSETS → static hosting or CDN

Keep the Cloudflare stack concrete until a second real target exists.

## 5. CI, previews, and tests

### Deploy workflow

Alchemy accepts the existing CI credentials: pass `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` as step env and use `--yes`. No profile file in CI.

```yaml
- name: Build
  run: bun run build

- name: Deploy
  run: bun alchemy deploy --stage prod --yes
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    GH_APP_ID: ${{ secrets.GH_APP_ID }}
    GH_APP_PRIVATE_KEY: ${{ secrets.GH_APP_PRIVATE_KEY }}
    GH_WEBHOOK_SECRET: ${{ secrets.GH_WEBHOOK_SECRET }}
```

The token must write D1 and R2, not only upload Worker scripts. Widen it before
the first Alchemy deploy.

### PR previews

Enabled for same-repo PRs:

- deploy on `opened` / `synchronize` / `reopened`:
  `bun alchemy deploy --stage pr-${{ github.event.number }} --yes`
- destroy on `closed`:
  `bun alchemy destroy --stage pr-${{ github.event.number }} --yes`
- guard with
  `if: github.event.pull_request.head.repo.full_name == github.repository`;
  fork PRs never receive the account token.
- concurrency group `preview-${{ github.event.number }}`; never cancel destroy.
- pass only the Cloudflare token/account. Preview stages omit `GH_APP_*`,
  webhook secrets, and the cron.
- comment the URL with `actions/github-script` from captured deploy output. If
  that output is unstable, link the workflow run instead of guessing a
  `workers.dev` hostname.

Cost is accepted: each preview owns a D1 database, R2 bucket, and Workflow.
Destroy-on-close is mandatory.

### Credentials as code (optional, skipped)

Alchemy can mint a scoped Cloudflare token from `alchemy/github.ts` and write it
as an Actions secret. That requires an admin profile that can create API tokens
(Global API Key or `API Tokens > Write`), which is root-like. The repo already
has a token; revisit only when rotation becomes a problem.

## 6. Risks

| Risk                                               | Impact                                | Mitigation                                                         |
| -------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| Workflow class not discovered in prebuilt `script` | Workflow binding fails                | Phase 0 spike; fall back to `main` and let Alchemy bundle          |
| D1/R2 not adopted by name                          | Data migration or duplicate resources | Test `--adopt`; export/import in a quiet window                    |
| D1 replacement deletes data                        | Data loss                             | Never change explicit D1 name/location in place; review plan first |
| Preview gets prod secrets or cron                  | Previews open PRs / receive webhooks  | Stage-conditional env, `crons: []`, same-repo guard                |
| Preview cleanup missed                             | Orphan D1/R2 cost                     | Mandatory destroy job; audit `pr-*` stages                         |
| Optional secrets become required                   | CI deploy fails when unset            | `Config.option`; required/optional split                           |
| Two config sources drift                           | Wrong bindings deployed               | Wrangler authoritative until Phase 4                               |
| `alchemy dev` weaker than Wrangler                 | Local dev surprises                   | Keep Wrangler dev until parity is proven                           |
| Alchemy beta churn                                 | Rework                                | Pin exact versions; stack stays small                              |

## 7. Verification

Per phase:

```bash
bun run typecheck
bun run build
bun alchemy plan --stage spike
bun alchemy deploy --stage spike --yes
ALCHEMY_DEV=1 bun run test:stack
bun run test:stack
bun alchemy destroy --stage spike --yes
```

Production smoke after Phase 3:

```bash
curl -s https://<worker-url>/api/health
curl -s https://<worker-url>/api/catalog
# dashboard root + deep link
# bad-signature webhook → 401/403
# create workflow instance → poll /api/runs/:id
```

Repository note: `bun run check` currently fails on pre-existing repo-wide
formatting. Do not mix that cleanup into this migration; run targeted formatting
on files touched here.

## 8. Decisions

1. **D1: migrate, do not reset.** Policies, memory, backlog, schedules, and
   audit history are not disposable. Adopt first; export/import as fallback.
2. **Stage: explicit `prod`.** Never `live_$USER` in CI or docs. Previews use
   `pr-<n>`; local dev keeps Alchemy's default.
3. **Workers AI: mandatory at cutover.** It is the only keyless provider and the
   dashboard default.
4. **Docs: not deployed for now.** `apps/docs` stays a build artifact; adding it
   later is one assets-only Worker in the same stack.
5. **Previews: enabled.** `pr-<n>` with mandatory destroy on close; no prod
   secrets, cron, or webhooks.
6. **Dev: replace `wrangler dev` with `alchemy dev`** after production parity.
7. **Layout: all Alchemy files under `alchemy/`.** Application code stays in its
   existing workspace.

## 9. References

- Getting started — https://alchemy.run/getting-started/
- CI — https://alchemy.run/environments/ci/
- Testing a Stack — https://alchemy.run/testing/testing-a-stack/
- Monorepo — https://alchemy.run/project-structure/monorepo/
- Workers — https://alchemy.run/cloudflare/workers
- Workflows — https://alchemy.run/cloudflare/workflows
- D1 — https://alchemy.run/cloudflare/d1
- R2 — https://alchemy.run/cloudflare/r2
- CLI — https://alchemy.run/cli
- Stages — https://alchemy.run/environments/stages
- Local development — https://alchemy.run/environments/local-development
- Secrets & Config — https://alchemy.run/environments/secrets
