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
| Docker     | only to build/deploy the Sandbox bridge image; needs a Linux host    |
| GitHub App | optional, for webhook automation without a long-lived `GITHUB_TOKEN` |

Windows can deploy the main Worker natively. The Sandbox bridge image cannot be
built by `wrangler dev` on native Windows; use WSL2 or a Linux CI runner.

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
bunx wrangler secret put GITHUB_APP_ID            # GitHub App automation
bunx wrangler secret put GITHUB_APP_PRIVATE_KEY   # PKCS#8 PEM
bunx wrangler secret put GITHUB_WEBHOOK_SECRET    # verifies x-hub-signature-256
bunx wrangler secret put GITHUB_TOKEN             # fallback when no App is set
bunx wrangler secret put SANDBOX_RUNNER_URL       # optional runner origin
bunx wrangler secret put SANDBOX_API_KEY          # optional runner key
bunx wrangler secret put DRIFT_WEBHOOK_URL        # optional Slack-compatible
bunx wrangler secret put DRIFT_WEBHOOK_SECRET     # sent as x-edgespec-secret
```

`GITHUB_TOKEN` is only a fallback for workflow runs. The dashboard always uses
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

The generated suite is only executed when a runner is configured. Two options:

- **Self-hosted** — `bun run sandbox` on a Linux host with `bwrap`, Docker or
  Podman; point `SANDBOX_RUNNER_URL` at it.
- **Cloudflare Sandbox bridge** — `apps/sandbox-worker`, built on Containers and
  `@cloudflare/sandbox`:

```bash
bun run deploy:sandbox-worker
```

Then set its `SANDBOX_API_KEY` as a secret on that Worker and point the main
Worker's `SANDBOX_RUNNER_URL` at the bridge origin. The bridge exposes `/health`
and `/run`; the key is required, otherwise anyone could execute code.

Without a runner, validation is **static check only** and `validation.verified`
is false. Never describe that as passed.

## 6. GitHub webhooks

Point the GitHub App or repository webhook at
`https://<worker>/webhook`, subscribe to **push**, **pull_request** and
**issue_comment**, and set `GITHUB_WEBHOOK_SECRET`. The workflow uses the
deployment's Workers AI binding and a short-lived App installation token; no
visitor key enters Workflow state.

## CI

- `.github/workflows/ci.yml` runs `bun run check`, both builds and the docs build
  on every push and pull request. No Cloudflare credentials required.
- `.github/workflows/deploy.yml` deploys `main` using the repository secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

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
