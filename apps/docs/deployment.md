# Deployment

EdgeSpec deploys as one Cloudflare Worker (API plus the built dashboard) with
D1, R2 and a separate Sandbox runner. The infrastructure lives in
`infra/cloudflare/cloudflare.run.ts`; there is no `wrangler.toml`. Nothing here stores a
visitor's configuration or keys: those still travel per request.

## Prerequisites

| Tool               | Notes                                                            |
| ------------------ | ---------------------------------------------------------------- |
| Bun                | `1.4.4`; installs Alchemy via the workspace and runs the build   |
| Node.js            | `>=22.12` (used by some tooling; Bun runs the tests)             |
| Cloudflare account | Alchemy profile with Workers, D1, R2 and Workers AI permissions  |
| Docker             | optional, for containerised `bun run sandbox` runs (Linux/WSL2)  |
| GitHub App         | optional, for webhook automation without a long-lived `GH_TOKEN` |

Wrangler is no longer used. A Wrangler login is not an Alchemy credential:
Alchemy keeps its own profile. Authenticate once:

```bash
bun install
bun run alchemy profile edit --profile default --add Cloudflare
# or non-interactive:
export CLOUDFLARE_API_TOKEN=…
export CLOUDFLARE_ACCOUNT_ID=…
bun run alchemy profile edit --profile default --add Cloudflare --method stored \
  --set apiToken=env:CLOUDFLARE_API_TOKEN \
  --set accountId=env:CLOUDFLARE_ACCOUNT_ID
```

The token needs Workers Scripts, D1, R2 and Workers AI permissions. The Alchemy
state store additionally needs the account-scope **Workers Secrets Store**
permission (Cloudflare's API names it _Secrets Store Read/Write_) and Workers
subdomain read access — a token that lists the four resource permissions but
omits Secrets Store passes a plain Workers/D1/R2 check yet still fails the
state-store refresh with `Authentication error`. Check with
`bun run alchemy profile show`.

A deploy that worked before and then fails during "Refreshing Cloudflare State
Store credentials" with `Unauthorized: Authentication error` means the token
was revoked, expired, or trimmed of a permission it needs — rotate it and
confirm `CLOUDFLARE_ACCOUNT_ID` still points at the right account.

Windows can deploy the Worker natively. Containerised sandbox runs
(`bun run sandbox`) need Docker on a Linux host (or WSL2).

## 1. D1 (run history and shared state)

D1 stores run summaries, backlog, policies, repository memory, schedules,
workspace settings, audit events and PR-command rate limits. It never stores
generated test source, prompts or keys.

The stack creates the database: `edge-spec-runs` for `--stage prod`, and
`edge-spec-runs-<stage>` for every other stage. Migrations in `migrations/` run
as part of `alchemy deploy` and `alchemy dev`; there is no separate
`db:migrate` command.

Node providers resolve SQL through `@edge-spec/db`:
`EDGESPEC_DB=postgres` + `EDGESPEC_DB_URL` for Postgres (apply
`migrations/postgres.sql` with `packages/runtime/scripts/migrate.ts`), or
`EDGESPEC_DB=sqlite` for a single-node deployment backed by Bun's built-in
sqlite (path from `EDGESPEC_DB_URL`, default `.data/edge-spec.sqlite`).
The sqlite driver applies the `NNNN_*.sql` migrations in `EDGESPEC_MIGRATIONS`
(default `migrations/`) at boot, ledger-style, applying each file once per
content hash.

The Worker still deploys without the binding (for example in a local bundle
test), but every history/backlog/workspace route then answers `enabled: false`
and the cron does nothing.

### Repairing migration bookkeeping

Alchemy records a `sha256` of each migration file in `__alchemy_migrations` and
refuses to deploy when a recorded hash no longer matches the file
(`RewrittenMigrationHistoryError`). Two things cause that without anyone
editing a migration: rewriting an applied file, and **line endings**.

The production cutover ran on Windows, where `core.autocrlf=true` rewrote the
`.sql` files to CRLF, so the recorded hashes are CRLF-based. CI checks out LF,
computes LF hashes, and every migration looks rewritten. `.gitattributes` pins
`*.sql` to LF so the hashes stay stable across platforms.

`bun run migrate:hashes` repairs the bookkeeping. It reads the recorded
hashes, and rewrites one **only** when it equals the CRLF hash of the same
file — proof that the file was not edited, only checked out with different
line endings. A hash that matches neither the LF nor the CRLF hash means the
migration was genuinely rewritten; the script leaves it alone and fails, so
Alchemy still rejects the deploy. Only the bookkeeping hash changes: the
schema is untouched and no migration is re-run.

```bash
bun run migrate:hashes                 # repair the live database
bun run migrate:hashes -- --print      # print the statements instead
```

The deploy workflow runs the repair before deploying, so a checkout that
drifted in line endings can never block a release. Edit an already-applied
migration only by adding a new file.

## 2. R2 (run artifacts and drift summaries)

D1 keeps summaries; R2 keeps the raw validation bundles and coverage facts
(`runs/<id>.json`) and drift summaries (`drift/<repo>/<time>.json`).

The stack creates `edge-spec-artifacts` for `prod` and
`edge-spec-artifacts-<stage>` elsewhere. Without the binding, runs still work
and `GET /api/runs/:id/artifacts` answers `enabled: false`.

## 3. Secrets

Secrets are deployment-owned. Visitor credentials are request headers and are
never written to Worker state. The stack reads these through `Config.Redacted`,
so a missing optional value is simply absent.

| Secret                       | Required              | Used by                             |
| ---------------------------- | --------------------- | ----------------------------------- |
| `GH_APP_ID`                  | For App auth          | Mint installation tokens            |
| `GH_APP_PRIVATE_KEY`         | For App auth          | PKCS#8 PEM used to sign the app JWT |
| `GH_TOKEN`                   | Fallback for webhooks | Workflow: scan, commit, PR          |
| `GH_WEBHOOK_SECRET`          | Recommended           | `POST /webhook` HMAC verification   |
| `DRIFT_ALERT_WEBHOOK_URL`    | Optional              | Drift notifications                 |
| `DRIFT_ALERT_WEBHOOK_SECRET` | Optional              | Sent as `x-edgespec-secret`         |

For a local deploy, export them or copy `infra/cloudflare/.env.example` to
`infra/cloudflare/.env` (git-ignored):

```bash
export GH_APP_ID=…
export GH_APP_PRIVATE_KEY="$(cat app.pk8.pem)"
export GH_WEBHOOK_SECRET=…
export GH_TOKEN=…                 # optional fallback
bun run deploy
```

In CI the same names are repository secrets passed as step env. Only `prod`
receives `GH_*`; preview stages omit them and use the visitor's token.

`GH_TOKEN` is only a fallback for workflow runs. The dashboard always uses
the visitor's token.

## 4. Deploy the Worker

```bash
bun run deploy                        # build + bun run --cwd infra/cloudflare deploy --stage prod
bun run --cwd infra/cloudflare deploy --stage staging --yes
```

`bun run deploy` builds `dist/web` and `dist/worker` first; Alchemy uploads the
existing Vite bundle, so there is only one bundler. The stack also serves the
dashboard through the `ASSETS` binding and registers the
`test-generation-workflow` Workflow plus the daily cron `0 8 * * *`
(per-repository schedules live in D1). Previews get no cron.

### Adopting existing resources

`bun run deploy` is the normal path; the production cutover already adopted the
Worker, D1, R2 and Workflow into Alchemy state on 2026-10-27. Use `--adopt` only
when Alchemy state is new — a fresh account, a lost state store, or a stage
created outside Alchemy:

```bash
bun run --cwd infra/cloudflare deploy --stage prod --yes --adopt
```

The names in the stack (`edge-spec`, `edge-spec-runs`, `edge-spec-artifacts`,
`test-generation-workflow`) are fixed for `prod`, which is what makes adoption
possible. Do not change them in place.

### Documentation site (Cloudflare Pages)

The stack declares one Pages project for the VitePress site, `edge-spec-docs`,
and only on `prod`. Preview and dev stages reuse the published site instead of
creating an empty `edge-spec-docs-<stage>` subdomain that serves nothing.
Alchemy owns the project; the Pages REST API has no public asset-upload
endpoint, so the static files go up through Wrangler:

```bash
bun run docs:deploy   # docs:build + wrangler pages deploy … --project-name edge-spec-docs
```

Live at `https://edge-spec-docs.pages.dev`. `bun run docs:build` alone still
only writes `apps/docs/.vitepress/dist`, so CI keeps checking the build without
publishing. A landing page is not hosted yet — the stack has a placeholder
comment where its project would go.

### Rollback

Wrangler is not a dependency any more, but `bunx wrangler` runs it without
reinstalling anything. Two paths:

**Fast — put the previous Worker version back.** This restores the code and its
bindings; it does not change this repository:

```bash
bunx wrangler deployments list --name edge-spec
bunx wrangler rollback --name edge-spec                # previous deployment
bunx wrangler rollback <version-id> --name edge-spec   # a specific one
```

**Full — restore the last Wrangler config and deploy it.** Keep this for a
release after the cutover, in case Alchemy itself has to be dropped:

```bash
git log --all --oneline -- wrangler.toml
git show <commit>:wrangler.toml > wrangler.toml
bunx wrangler deploy --dry-run --config wrangler.toml  # check first
bunx wrangler deploy --config wrangler.toml
```

Neither path touches D1 or R2 data, so a later `bun run --cwd infra/cloudflare deploy --stage
prod` picks the Worker back up without re-adopting.

## 5. Staging parity

Deploy a throwaway stage and run the stack test against it:

```bash
bun run build
bun run --cwd infra/cloudflare deploy --stage staging --yes
SKIP_DEPLOY=1 STACK_URL=https://edge-spec-staging.<subdomain>.workers.dev \
  bun run --cwd infra/cloudflare test
bun run --cwd infra/cloudflare destroy --stage staging --yes
```

The automated test covers `/api/health`, `/api/catalog`, the dashboard root and
a deep link, and D1 (workspace + run history). The same assertions run locally
against the emulators; stop `bun run dev:worker` first, because both bind 8787:

```bash
ALCHEMY_DEV=1 bun run --cwd infra/cloudflare test
```

Check the rest manually:

- `GET /api/quota`
- `/api/scan` against a public fixture repository
- `/webhook` with a bad signature (production only; other stages have no secret)
- a run that writes D1 history and an R2 artifact
- Workflow create + poll `/api/runs/:id`
- the `scheduled` path through `alchemy dev` or a staging cron

## 6. Sandbox runner (optional)

The generated suite is only executed when a runner is configured. The
repository ships `packages/sandbox`, a Bun HTTP service that runs each request
under `bwrap`, Docker or Podman, or in a hosted E2B/Vercel/Daytona sandbox:

```bash
bun run sandbox                     # 127.0.0.1:8788, auto-detect
SANDBOX_API_KEY=... bun run sandbox # required when binding beyond loopback
```

Each user configures the runner in **Settings → Sandbox**. The URL travels in
`x-sandbox-url`, the key in `x-sandbox-key`, and the non-secret knobs in
`x-sandbox-config`; no Worker secret is required. Webhook runs have no user
headers, so they stay static-only unless an operator sets an optional
deployment fallback. The runner exposes `/health` and `/run`; without a key it
binds loopback only. Check the connection:

```bash
curl http://127.0.0.1:8788/health
curl -X POST https://<worker>/api/sandbox/health -d '{}'
```

Without a runner, validation is **static check only** and `validation.verified`
is false. Never describe that as passed.

## 7. GitHub App and webhooks

The webhook endpoint is `https://<worker>/webhook`; it accepts `push`,
`pull_request`, and `issue_comment` payloads and acknowledges other App
deliveries (`ping`, `installation`) with 202. A GitHub App is recommended for
multiple repositories because the payload carries `installation.id`, which the
Worker uses to mint a repository-scoped installation token.

Full setup—permissions, events, private-key generation, PKCS#8 conversion, and
verification—is on the dedicated [GitHub App and webhooks](/github-app) page.

Short version:

| Secret               | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| `GH_APP_ID`          | Numeric App ID                                         |
| `GH_APP_PRIVATE_KEY` | PKCS#8 PEM contents                                    |
| `GH_WEBHOOK_SECRET`  | App/repository webhook secret (`openssl rand -hex 32`) |
| `GH_TOKEN`           | Optional PAT fallback                                  |

Do not pass these to `TestGenerationWorkflow`; Workflow params are persisted.

## 8. Other targets (Vercel, AWS, Fly, Railway, Docker, Kubernetes, Bun)

The app is split into ports (`SqlDatabase`, `ObjectStore`, `JobQueue`,
`CacheStore`) behind `packages/runtime/src/adapters/select.ts`. Cloudflare keeps its
bindings; every other target is selected by env:

```text
binding -> EDGESPEC_<CAP> override -> EDGESPEC_PROVIDER default -> off
```

`EDGESPEC_PROVIDER=vercel|aws|node` only supplies defaults for capabilities
whose env is present. A missing capability stays off and the routes answer
`enabled: false` / `501` / `404`, exactly as an unbound Worker does today.
Fly, Railway, Docker and Kubernetes all run the Bun entry, so they use the
`node` defaults (`EDGESPEC_PROVIDER=node`) and keep their configuration in the
platform's own secret store.

| Capability | Cloudflare                 | Vercel / AWS / Bun                                                                                         |
| ---------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| SQL        | `RUNS_DB` (D1)             | `EDGESPEC_DB_URL=postgres://…`                                                                             |
| Objects    | `ARTIFACTS` (R2)           | `EDGESPEC_BLOB_ENDPOINT`, `_BUCKET`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, optional `_PREFIX` |
| Jobs       | `TEST_GENERATION_WORKFLOW` | `EDGESPEC_JOB_URL`, `EDGESPEC_JOB_KEY`                                                                     |
| Cache      | `CACHE` (KV)               | `EDGESPEC_REDIS_URL`, `EDGESPEC_REDIS_TOKEN`                                                               |
| Cron       | `scheduled`                | `CRON_SECRET` + `POST /api/cron/tick`                                                                      |
| AI         | `AI` binding               | `AI_PROVIDER`, `AI_KEY`, `AI_BASE_URL`, `AI_MODEL`                                                         |
| Static     | `ASSETS`                   | host CDN, or `EDGESPEC_STATIC_DIR` for the Bun entry                                                       |

Overrides: `EDGESPEC_DB=d1|postgres|sqlite`, `EDGESPEC_BLOB=r2|s3`,
`EDGESPEC_JOBS=http|workflows`, `EDGESPEC_CACHE=kv|redis|memory`. An explicit
override whose env is missing fails at boot and names the variable.

**Postgres.** Apply the schema once with `bun run migrate`
(`EDGESPEC_DB_URL=postgres://… bun run migrate`). D1 keeps using
`migrations/*.sql` through Alchemy; Postgres uses `migrations/postgres.sql`.
Re-running is safe: applied versions are recorded in `schema_migrations`, and an
edited schema file gets a new version and re-applies.

**Job runner contract.** `http-jobs.ts` speaks:

```text
POST {EDGESPEC_JOB_URL}/jobs      { id?, params } -> { id }
GET  {EDGESPEC_JOB_URL}/jobs/:id                 -> { status, error?, output?, steps? }
Authorization: Bearer $EDGESPEC_JOB_KEY
```

The runner owns durability (Vercel Queues, SQS + ECS, Step Functions, or a small
Bun service) and calls `runGenerationJob(params, step, env)` from
`packages/runtime/src/jobs.ts` with its own step runner. Vercel Workflows is
directive-based (`"use workflow"` / `"use step"`) and is not a drop-in adapter;
it belongs in that separate runner.

**Cron.** Vercel reads `vercel.json`; AWS uses EventBridge Scheduler, GCP Cloud
Scheduler, Azure a timer function, or a GitHub Actions schedule. Each sends
`Authorization: Bearer $CRON_SECRET` (or `x-cron-secret`) to
`POST /api/cron/tick`. The route 404s when no secret is configured, so the
Cloudflare `scheduled` handler and an HTTP cron never double-run by accident.

**Cache.** `CACHE` (Cloudflare KV), Upstash Redis REST, or an in-process `Map`
(single node only). It is read-through and never authoritative: quota and branch
lookups for 60s, keyed by a token fingerprint, never by the raw token. A cache
error is a miss; the request still succeeds.

**Entries.** `apps/worker/src/index.ts` is Cloudflare,
`infra/vercel/handler.ts` + `api/index.ts` are Vercel, and
`packages/runtime/src/server.ts` is Bun/Node (`bun run serve`). Provider glue
and IaC live under `infra/<provider>/`; `api/index.ts` and `vercel.json` are
one-line root exceptions because Vercel only reads those at the project root.
Node-only adapters (`pg`, `aws4fetch`) are imported lazily and are never
reachable from the Cloudflare entry.

**IaC.** One folder and one Alchemy stack per target:

| Target     | Folder             | Stack file          | Command                     |
| ---------- | ------------------ | ------------------- | --------------------------- |
| Cloudflare | `infra/cloudflare` | `cloudflare.run.ts` | `bun run deploy`            |
| AWS        | `infra/aws`        | `aws.run.ts`        | `bun run deploy:aws`        |
| Vercel     | `infra/vercel`     | `vercel.run.ts`     | `bun run deploy:vercel`     |
| Fly        | `infra/fly`        | `fly.run.ts`        | `bun run deploy:fly`        |
| Railway    | `infra/railway`    | `railway.run.ts`    | `bun run deploy:railway`    |
| Docker     | `infra/docker`     | `docker.run.ts`     | `bun run deploy:docker`     |
| Kubernetes | `infra/kubernetes` | `kubernetes.run.ts` | `bun run deploy:kubernetes` |

`infra/shared/stage.ts` is the only shared file. Each provider folder owns its
`.env.example`, Alchemy scripts and one stack test: `infra/<target>/test/
stack.integration.ts`.

`bun run test:stack` builds and runs every target's stack test, and
`bun run test:<target>` runs one (`test:cloudflare`, `test:aws`, `test:vercel`,
`test:fly`, `test:railway`, `test:docker`, `test:kubernetes`). Every test is
deliberately not named `*.test.ts`, so plain `bun test` never provisions cloud
resources; each deploys its real stack and probes what it returns (Cloudflare:
health, catalog, assets and D1 parity; AWS: the artifact bucket; Vercel: the
memoized `vercel deploy`; Fly/Railway/Docker/Kubernetes: the deployed URL's
`/api/health`). Any test supports `SKIP_DEPLOY=1` to run its assertions
against a live URL you supply through `STACK_URL`.

The Fly, Railway, Docker and Kubernetes stacks all build the same root
`Dockerfile` (`oven/bun` running `packages/runtime/src/server.ts`). Fly pushes
that image to `registry.fly.io`; Railway builds the uploaded context; Docker
runs it locally; Kubernetes builds it into the cluster's registry (kind for
`ALCHEMY_DEV=1`). Runtime configuration stays platform-native — Fly secrets,
Railway variables, Kubernetes ConfigMap/Secret, or `infra/docker/.env` — rather
than being persisted in Alchemy state.

The AWS stack owns the artifact bucket (`EDGESPEC_BLOB=s3`); Postgres, the job
runner and cron stay external. The Vercel stack is a `Command.Exec` around
`vercel deploy --prod` because Alchemy has no Vercel provider; it needs
`VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.

## CI

- `.github/workflows/ci.yml` runs `bun run verify`, both builds and the docs build
  on every push and pull request. No Cloudflare credentials required.
- `.github/workflows/deploy.yml` builds and deploys `main` with Alchemy using
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the optional GitHub App
  credentials. Dispatch it with **adopt** only when the Alchemy state store is
  new; the production cutover is already in state.
- Set the `STACK_URL` repository variable to smoke the deployment after each
  production run.

## Verify a deployment

```bash
curl -s https://<worker>/api/health
curl -s https://<worker>/api/catalog
curl -s https://<worker>/api/workspace     # enabled:true when D1 is migrated
curl -s https://<worker>/api/runs/01234567-89ab-cdef-0123-456789abcdef/artifacts
```

`/api/workspace` answering `enabled:false` means D1 is unbound or unmigrated.
A `404` from the artifacts route with `enabled:true` only means that run stored
no bundle.
