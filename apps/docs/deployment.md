# Deployment

EdgeSpec deploys as one Cloudflare Worker (API plus the built dashboard) with
optional D1, R2 and a separate Sandbox runner. Nothing here stores a visitor's
configuration or keys: those still travel per request.

## Prerequisites

| Tool       | Notes                                                                |
| ---------- | -------------------------------------------------------------------- |
| Bun        | `1.4.4`; installs Wrangler and runs the build                        |
| Node.js    | `>=22.12` (used by some tooling; Bun runs the tests)                 |
| Wrangler   | installed by `bun install`; authenticated with `bunx wrangler login` |
| Docker     | optional, for containerised `bun run sandbox` runs (Linux/WSL2)      |
| GitHub App | optional, for webhook automation without a long-lived `GH_TOKEN`     |

Windows can deploy the Worker natively. Containerised sandbox runs
(`bun run sandbox`) need Docker on a Linux host (or WSL2).

```bash
bun install
bunx wrangler login
```

## 1. D1 (run history and shared state)

D1 stores run summaries, backlog, policies, repository memory, schedules,
workspace settings, audit events and PR-command rate limits. It never stores
generated test source, prompts or keys.

```bash
bunx wrangler d1 create edge-spec-runs
```

Copy the returned `database_id` into `wrangler.toml` (`RUNS_DB`), then apply the
migrations:

```bash
bun run db:migrate          # remote
bun run db:migrate:local    # the local .wrangler database
```

The Worker deploys without D1, but every history/backlog/workspace route then
answers `enabled: false` and the cron does nothing.

## 2. R2 (run artifacts and drift summaries)

D1 keeps summaries; R2 keeps the raw validation bundles and coverage facts
(`runs/<id>.json`) and drift summaries (`drift/<repo>/<time>.json`).

```bash
bunx wrangler r2 bucket create edge-spec-artifacts
```

The bucket name is already bound as `ARTIFACTS` in `wrangler.toml`. Without the
binding, runs still work and `GET /api/runs/:id/artifacts` answers
`enabled: false`.

## 3. Secrets

Secrets are deployment-owned. Visitor credentials are request headers and are
never written to Worker state.

```bash
bunx wrangler secret put GH_APP_ID            # GitHub App automation
bunx wrangler secret put GH_APP_PRIVATE_KEY   # PKCS#8 PEM
bunx wrangler secret put GH_WEBHOOK_SECRET    # verifies x-hub-signature-256
bunx wrangler secret put GH_TOKEN             # fallback when no App is set
bunx wrangler secret put DRIFT_WEBHOOK_URL        # optional fallback; prefer Settings
bunx wrangler secret put DRIFT_WEBHOOK_SECRET     # sent as x-edgespec-secret
```

`GH_TOKEN` is only a fallback for workflow runs. The dashboard always uses
the visitor's token.

## 4. Deploy the Worker

```bash
bun run build
bun run deploy            # wrangler deploy, reads dist/worker and dist/web
```

`bun run deploy -- --dry-run` checks the bundle without uploading. The Worker
serves the dashboard through the `ASSETS` binding and registers the
`test-generation-workflow` Workflow plus the daily cron `0 8 * * *`
(per-repository schedules live in D1).

## 5. Sandbox runner (optional)

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

## 6. GitHub App and webhooks

The webhook endpoint is `https://<worker>/webhook`; it accepts `push`,
`pull_request`, and `issue_comment` payloads. A GitHub App is recommended for
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

- `.github/workflows/ci.yml` runs `bun run check`, both builds and the docs build
  on every push and pull request. No Cloudflare credentials required.
- `.github/workflows/deploy.yml` builds and deploys `main` with Alchemy using
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the optional GitHub App
  credentials. The first production run needs `--adopt` to import the existing
  Worker, D1, R2, and Workflow.

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
