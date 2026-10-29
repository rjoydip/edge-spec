# Deployment

EdgeSpec deploys as one Cloudflare Worker (API plus the built dashboard) with
D1, R2 and a separate Sandbox runner. The infrastructure lives in
`infra/alchemy.run.ts`; there is no `wrangler.toml`. Nothing here stores a
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
state store additionally needs account-level Workers access (Secrets Store and
the workers.dev subdomain), so mint the token with the account-scope Workers
resource included. Check with `bun run alchemy profile show`.

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

The Worker still deploys without the binding (for example in a local bundle
test), but every history/backlog/workspace route then answers `enabled: false`
and the cron does nothing.

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

For a local deploy, export them or copy `infra/.env.example` to
`infra/.env` (git-ignored):

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
bun run deploy                        # build + bun run alchemy deploy --stage prod
bun run alchemy deploy --stage staging --yes
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
bun run alchemy deploy --stage prod --yes --adopt
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

Neither path touches D1 or R2 data, so a later `bun run alchemy deploy --stage
prod` picks the Worker back up without re-adopting.

## 5. Staging parity

Deploy a throwaway stage and run the stack test against it:

```bash
bun run build
bun run alchemy deploy --stage staging --yes
SKIP_DEPLOY=1 STACK_URL=https://edge-spec-staging.<subdomain>.workers.dev \
  bun run --cwd infra test
bun run alchemy destroy --stage staging --yes
```

The automated test covers `/api/health`, `/api/catalog`, the dashboard root and
a deep link, and D1 (workspace + run history). The same assertions run locally
against the emulators; stop `bun run dev:worker` first, because both bind 8787:

```bash
ALCHEMY_DEV=1 bun run --cwd infra test
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
