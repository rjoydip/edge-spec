# EdgeSpec — Implementation Plan

EdgeSpec finds untested code in a GitHub repository, generates tests with the
AI model **you** choose, validates them, and opens a pull request. One
Cloudflare Worker serves the API and the dashboard.

---

## 1. Review feedback (must-haves)

These corrections to the first mockup are part of the definition of done.

| #   | Feedback                                                                                                  | Change in this plan                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Header items not in proper alignment                                                                      | One header row, `items-center`, every control a fixed 36 px (`h-9`) or icon button. Stats move out of the header into the Pipeline page's KPI strip.                                                                                                                                                                                         |
| 2   | No visible vertical scrollbar, but the page still scrolls                                                 | `.no-scrollbar` utility (`scrollbar-width: none`, `::-webkit-scrollbar { display: none }`) on the page root and the terminal pane. Scroll behaviour is unchanged.                                                                                                                                                                            |
| 3   | Application name is **EdgeSpec**                                                                          | `package.json`, `wrangler.toml`, `<title>`, brand mark, PR footer, docs. No "Testflare".                                                                                                                                                                                                                                                     |
| 4   | Repository must be user-supplied                                                                          | `owner/name` input in the header, persisted in local storage; every API call requires `repo`. No server-side default repository.                                                                                                                                                                                                             |
| 5   | "Cloudflare Workflows v2" must not be in the header                                                       | Removed. Header shows product name, repo, provider badge, theme toggle, settings only. Engine detail belongs in docs, not chrome.                                                                                                                                                                                                            |
| 6   | Theme toggle (dark/light) missing                                                                         | Sun/Moon icon button in the header, `html.dark` / `html.light`, applied before first paint, persisted.                                                                                                                                                                                                                                       |
| 7   | Application needs settings                                                                                | One Settings dialog (header gear): AI, Pipeline, Appearance. Repository and branch live in the header.                                                                                                                                                                                                                                       |
| 8   | Colour palette for the application colour                                                                 | 10-swatch accent palette in Settings. A single `--accent-base` hex drives the whole UI through `color-mix()`.                                                                                                                                                                                                                                |
| 9   | Application must be user-configurable                                                                     | Repo, ref, provider, model, keys, base URL, coverage target, retries, parallel generation and strict-mode all live in browser settings and travel per request. The deployment stores no user configuration.                                                                                                                                  |
| 10  | User chooses the AI model and supplies a key when it is not Cloudflare AI; private LLM provider supported | Model catalog grouped by provider. Cloudflare Workers AI needs no key. Every other provider requires the user's key. A **Private / OpenAI-compatible** entry accepts a base URL + model name, so vLLM, Ollama, LiteLLM, Azure-style gateways and corporate proxies work. Keys are sent as request headers and never persisted by the Worker. |

---

## 2. Technology decisions

| Area             | Decision                                                                                                                        | Why                                                              |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------- |
| Runtime          | Cloudflare Workers (TypeScript)                                                                                                 | Request API + static assets                                      |
| HTTP             | `hono`                                                                                                                          | Small router, SSE helper, typed bindings                         |
| Orchestration    | Cloudflare Workflows (`TestGenerationWorkflow`)                                                                                 | Durable webhook automation path                                  |
| Interactive path | `POST /api/run` (SSE)                                                                                                           | Live step logs; BYO keys never enter durable workflow state      |
| LLM              | Workers AI binding, or any OpenAI-compatible / Anthropic / Gemini endpoint                                                      | User's choice; key stays client-side                             |
| GitHub           | REST via `fetch`                                                                                                                | No SDK, no bundle weight; token per request                      |
| Test validation  | Optional sandbox runner (`SANDBOX_RUNNER_URL`), else static check                                                               | Honest `verified` flag instead of pretending tests ran           |
| State            | Optional D1 for history, backlog, policies, memory, schedules, workspace and audit; browser local storage for per-user settings | Stateless by default; shared data is opt-in and never holds keys |
| Dashboard        | React 19 + Tailwind v4 + Vite                                                                                                   | Same stack as the reference project                              |
| Icons            | `lucide-react`                                                                                                                  | Matches the mockup                                               |
| Tests            | `bun test` for the pure core                                                                                                    | One runnable check per non-trivial rule                          |
| Deploy           | Wrangler (Worker + assets)                                                                                                      | One deployable unit                                              |

**Design principle.** Pure functions (`scanner`, `ai` prompt/parse, `validate`)
know nothing about HTTP. The Worker and the Workflow are thin adapters over the
same core functions.

---

## 3. Architecture

```
browser / CLI / MCP ──▶ /api/run (SSE) ─┐
browser / CLI / MCP ──▶ /api/*          ─┼─▶ core ─▶ GitHub REST
GitHub              ──▶ /webhook ──▶ Workflow ─┘      └─▶ AI provider (user key or AI binding)
```

- `packages/core/src/*` — pure logic, unit-tested without network.
- `packages/client/src/*` — Worker API client shared by the CLI and MCP server.
- `apps/worker/src/index.ts` — Hono routes, header parsing, SSE.
- `apps/worker/src/workflow.ts` — durable webhook path (deployment-owned credentials).
- `apps/worker/src/db.ts`, `scheduled.ts` — optional D1 queries and the cron.
- `apps/web/src/*` — dashboard; talks only to `/api/*`.
- `packages/cli/src/*` — terminal commands.
- `packages/mcp/src/*` — stdio MCP server.
- `packages/ui`, `packages/sandbox` — shared React primitives and runners.

---

## 4. Directory structure

```text
edge-spec/
├── PLAN.md, TASKS.md, AGENTS.md, README.md
├── package.json              # Bun workspaces and root scripts
├── bunfig.toml               # Bun formatter settings
├── tsconfig.base.json
├── wrangler.toml
├── migrations/               # 0001–0007: runs, policies, commands, drift,
│                             # backlog, repo memory, workspace/audit
├── evals/                    # golden cases and the eval runner
├── examples/                 # scenario apps and reference tests
├── .github/workflows/{ci.yml,deploy.yml}
├── apps/
│   ├── web/
│   │   ├── index.html, vite.config.ts
│   │   └── src/
│   │       ├── main.tsx, App.tsx, api.ts
│   │       ├── tailwind.css
│   │       ├── lib/{theme.ts,settings.ts,utils.ts}
│   │       └── components/agent/{workspace.tsx,dialogs.tsx,settings-sheet.tsx,...}
│   ├── worker/
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── env.ts, cloudflare.d.ts, index.ts
│   │       ├── workflow.ts, db.ts, scheduled.ts, impact.ts, ownership.ts
│   ├── sandbox-worker/       # Cloudflare Sandbox bridge (Container)
│   │   ├── wrangler.toml
│   │   └── src/{index.ts,contract.ts}
│   └── docs/                 # VitePress site
└── packages/
    ├── core/
    │   ├── src/              # scanner, coverage, openapi, pipeline, github,
    │   │                     # ai, validate, policy, memory, drift, impact,
    │   │                     # history, routing, catalog, types
    │   └── test/
    ├── client/src/{client.ts,env.ts,run.ts,index.ts}
    ├── ui/src/               # shared React primitives + theme.css
    ├── cli/src/{index.ts,args.ts,watch.ts}
    ├── mcp/src/{index.ts,server.ts}
    └── sandbox/src/          # bwrap/Docker/Podman + hosted drivers
```

Both Vite builds write to the root `dist/` (`dist/web` and `dist/worker`), which
Wrangler uploads.

---

## 5. Configuration (`wrangler.toml`)

```toml
name = "edge-spec"
main = "dist/worker/index.js"
compatibility_date = "2025-07-18"
compatibility_flags = ["nodejs_compat"]

# Daily cron: apply workspace retention, then run due drift scans.
[triggers]
crons = ["0 8 * * *"]

[assets]
directory = "dist/web"
binding = "ASSETS"
not_found_handling = "single-page-application"

[ai]
binding = "AI"
remote = true

[[workflows]]
name = "test-generation-workflow"
binding = "TEST_GENERATION_WORKFLOW"
class_name = "TestGenerationWorkflow"

# Run history, backlog, memory, policies, workspace and audit.
# Create the database, apply the migrations in `migrations/`, then deploy.
[[d1_databases]]
binding = "RUNS_DB"
database_name = "edge-spec-runs"
database_id = "<paste-the-id-here>"

# Run artifacts and drift summaries. Retention prunes run bundles; drift
# summaries have no D1 row to age out yet (see TASKS.md).
[[r2_buckets]]
binding = "ARTIFACTS"
bucket_name = "edge-spec-artifacts"
```

- Without `RUNS_DB` the Worker still scans, generates and opens pull requests;
  history, backlog, policies, memory, workspace and audit answer disabled, and
  the cron does nothing.
- Secrets are for the automation path only: `GITHUB_APP_ID` +
  `GITHUB_APP_PRIVATE_KEY` (or `GITHUB_TOKEN`), `GITHUB_WEBHOOK_SECRET`,
  `SANDBOX_RUNNER_URL`, `SANDBOX_API_KEY`, `DRIFT_WEBHOOK_URL`,
  `DRIFT_WEBHOOK_SECRET`.
- The interactive path uses headers: `x-github-token`, `x-ai-key`,
  `x-ai-base-url`, `x-sandbox-url`, `x-sandbox-key`, `x-sandbox-config`.
- No KV and no Queue binding. Workspace records hold a name, a retention
  window and non-secret shared settings, not keys.

---

## 6. Data model

- `Gap` — `path`, `testPath`, `risk` (`high|medium|low`), `exports[]`, `reason`,
  optional `kind` (`missing|coverage|api|unsupported`), `language`, `evidence`.
  A file with no test is `missing`; an existing test below the target is
  `coverage`; an OpenAPI operation without a contract test is `api`; a language
  EdgeSpec cannot generate for is `unsupported` (informational). No invented
  coverage percentage: coverage is only a fact from a runner's LCOV report.
- `ScanResult` — `repo`, `ref`, `scanned`, `gaps[]` (missing only, old clients),
  plus `coverageGaps`, `apiGaps`, `unsupported`, `totals`, `truncated` and
  `coverageStatus` (`not-run|unavailable|measured`).
- `Generation` — `sourcePath`, `testPath`, `code`, `provider`, `model`.
- `Validation` — `ok`, `verified`, `output`, `durationMs`.
- `RunEvent` — `{ type: "log" | "step" | "gaps" | "quota" | "generation" | "validation" | "result" | "error" | "done", ... }` streamed over SSE.
- `Settings` (browser) — provider, model, base URL, coverage target, retries,
  parallel generation, strict mode, policy copy, theme, accent.
- `Project` (browser) — repo and ref, stored separately from Settings.
- `RunSummary` / `RunFile` (D1, optional) — totals, cost, provider/model,
  decisions, verification, checks and coverage per file. No prompts or source.
- `Workspace` (D1, optional) — `id`, `name`, `retentionDays`, timestamps. One
  lazy `default` record per deployment; not a user account.
- `AuditEvent` (D1, optional) — `repo`, `actor`, `action`, redacted `detail`,
  `createdAt`.
- `Policy`, `RepoMemory`, `ScheduledRepo`, `BacklogItem`, `DriftSnapshot` (D1,
  optional) — shared non-secret records. No key, token or source column.

---

## 7. AI providers

| Provider id  | Protocol                    | Needs key | Example models                                                                                                                    |
| :----------- | :-------------------------- | :-------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| `workers-ai` | Cloudflare binding          | no        | `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/qwen/qwen2.5-coder-32b-instruct`, `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` |
| `openai`     | OpenAI chat completions     | yes       | `gpt-6-astra`, `gpt-6.1-sol`                                                                                                      |
| `anthropic`  | Anthropic messages          | yes       | `claude-sonnet-4-20250514`, `claude-3-5-haiku-latest`                                                                             |
| `google`     | Gemini generateContent      | yes       | `gemini-2.0-flash`, `gemini-2.5-pro`                                                                                              |
| `groq`       | OpenAI-compatible           | yes       | `llama-3.3-70b-versatile`                                                                                                         |
| `deepseek`   | OpenAI-compatible           | yes       | `deepseek-chat`, `deepseek-reasoner`                                                                                              |
| `mistral`    | OpenAI-compatible           | yes       | `mistral-large-latest`                                                                                                            |
| `openrouter` | OpenAI-compatible           | yes       | `anthropic/claude-sonnet-4`, `openai/gpt-4.1`                                                                                     |
| `private`    | OpenAI-compatible, user URL | optional  | any served model name                                                                                                             |

Rules:

- Cloudflare Workers AI is the default (binding, no key to paste). Adding a
  32-character account ID and Cloudflare API token switches it to BYOK REST.
- Any non-`workers-ai` provider without a key returns `400` with a clear message
  before any network call.
- `private` requires a base URL; the key is optional because local servers
  (Ollama, vLLM) often have none.
- API keys live in browser local storage (with Clear), are sent only to this
  origin, and are forwarded directly to the chosen provider. The Worker never
  logs or stores them.

---

## 8. API surface

| Method           | Path                                 | Purpose                                             |
| :--------------- | :----------------------------------- | :-------------------------------------------------- |
| `GET`            | `/api/health`                        | Liveness                                            |
| `GET`            | `/api/quota`                         | Provider quota when a key is supplied               |
| `GET`            | `/api/catalog`                       | Providers, models, defaults (drives Settings)       |
| `GET`            | `/api/branches`                      | Branch names + default branch for the header        |
| `POST`           | `/api/scan`                          | Missing/coverage/api/unsupported gaps + totals      |
| `POST`           | `/api/coverage`                      | Run the suite with coverage; coverage gaps + status |
| `POST`           | `/api/impact`                        | Tests affected by changed files                     |
| `POST`           | `/api/record`                        | Record a fixture session                            |
| `POST`           | `/api/run`                           | SSE stream: scan → generate → validate → PR         |
| `POST`           | `/api/generate`                      | Single generation (diff view's Retry)               |
| `POST`           | `/api/pull-request`                  | Open a PR for already-generated tests               |
| `GET`            | `/api/pulls`                         | Recent pull requests                                |
| `GET`            | `/api/runs`                          | Run history for a repo                              |
| `DELETE`         | `/api/runs`                          | Delete one repo's run history                       |
| `GET`            | `/api/runs/:id`                      | D1 run summary, or Workflow status when unknown     |
| `GET`            | `/api/runs/:id/files`                | Per-file decisions and checks                       |
| `POST`           | `/api/runs/:id/decisions`            | Accept/reject generated files                       |
| `GET/PATCH`      | `/api/backlog`                       | Test-debt backlog with state and owner              |
| `GET/PUT/DELETE` | `/api/schedules`                     | Per-repo drift schedule                             |
| `GET/PUT/DELETE` | `/api/memory`                        | Repository conventions for prompts                  |
| `GET/PUT/DELETE` | `/api/policies`                      | Per-repo pull-request policy                        |
| `GET/PUT`        | `/api/workspace`                     | Workspace name and retention window                 |
| `GET`            | `/api/audit`                         | Redacted audit events, optionally by repo           |
| `POST`           | `/api/sandbox/health`                | Runner capability check                             |
| `POST`           | `/webhook`                           | GitHub push / PR / comment → durable Workflow       |
| `GET`            | `/local-api/scan`, `/local-api/file` | Local watch mode only                               |

Headers: `x-github-token`, `x-ai-key`, `x-ai-base-url`, `x-sandbox-url`,
`x-sandbox-key`, `x-sandbox-config`, `x-deployment-ai`. The webhook verifies
`x-hub-signature-256` when a secret is configured.

---

## 9. UI specification

Single page with four stages: **Repository** → **Agent Activity** → **Gap
Analysis** → **Review Queue**. History and Backlog open as dialogs. Settings is
a dialog, not a stage (one configuration surface, not two).

### Header (fixed, aligned)

- Left: EdgeSpec mark + name.
- Centre/left: repo input (`owner/name`, 36 px, monospace), a branch dropdown
  fetched from GitHub, and a provider badge (`Workers AI` / provider name + key
  state).
- Right: History, Backlog, theme toggle (icon), Settings (gear + label).
- All controls `h-9`, one `items-center` flex row, no wrapping below `md`; the
  repo input flexes.

### Page

- `min-h-dvh`, `.no-scrollbar`; content container `max-w-7xl`.
- Stage headers and wide tables stay usable on small screens with
  `.no-scrollbar` horizontal scrolling.
- **Diff** highlights the generated test with Kirari using theme tokens. After
  generating, it offers the next gap instead of opening a PR.
- **Review** queues every generated test; PRs open from there, one row at a
  time, with validation gates.

### Settings dialog

1. **GitHub access** — GitHub token (password field, Clear). Repository and
   branch live in the header, not here.
2. **AI provider** — provider select, model select (filtered by provider), API
   key, base URL (private only), model name (private). Workers AI also shows an
   optional Cloudflare account ID + token for BYOK.
3. **Pipeline** — coverage target, retries, files per run, concurrency, token
   budget, strict TypeScript, and the policy gates (draft-only, max files,
   allowed paths, coverage floor, labels/reviewers).
4. **Appearance** — dark/light segmented control + 10 accent swatches.
5. Save/Cancel; unsaved changes are local until Save.

### Appearance

- Dark is the default; light is a full ramp remap, not a second component set.
- Accent is one `--accent-base` variable; `indigo-*` utilities alias onto it.
- `index.html` applies stored theme + accent before first paint (no flash).

---

## 10. Pipeline behaviour

1. **Scan** — Git tree (recursive), filter `src/**` source files, skip tests,
   declarations and generated files, map expected test paths, report missing
   ones with risk and exported symbols.
2. **Generate** — prompt contains path + source; output is parsed out of a code
   fence; the file must contain at least one `describe`/`it`/`test`.
3. **Validate** — if `SANDBOX_RUNNER_URL` is configured, POST source + test and
   run `bun test`; otherwise run the static check and report
   `verified: false` ("static check only").
4. **Self-correct** — if validation is verified and fails, feed the output back
   to the model up to `maxRetries`.
5. **PR** — create branch, commit the test, open a PR; only when validation
   passes (or the user explicitly chose to skip verification).
6. Stream every phase as an SSE event so the terminal and DAG update live.

The durable Workflow runs the same four core steps for webhook automation and
never receives user API keys.

Later features extend this path without changing its honesty rules:
runner adapters choose the repo's test framework, the impact graph narrows PR
checks and retests, policy gates block before GitHub writes, and coverage delta,
flaky repeats, mutation and contract fixtures report "not measured" whenever
their runner did not execute.

---

## 11. Security

- No secrets in the repo, the bundle, or durable state.
- User keys travel as headers over same-origin requests, are held in memory for
  the duration of the call, and are redacted from errors.
- Repo/path inputs are validated (`owner/name`, no traversal) before building
  GitHub URLs.
- Generated test content is committed as-is; no execution on the Worker.
- The webhook path verifies `x-hub-signature-256` when a secret is configured.
- Shared D1 data is non-secret: policies, memory, backlog, schedules and the
  workspace record never hold a key. Audit detail is redacted recursively for
  token/key/secret/password/authorization/cookie keys, and retention deletes old
  rows on the daily cron.
- GitHub App installation tokens are scoped to one repository and cached only
  until expiry.
- Opening a pull request from MCP requires a one-time approval token that expires
  after ten minutes. Local watch sends inline source only to a local Worker.

---

## 12. Phases

1. **Foundation** — package, configs, Tailwind tokens, theme + settings stores.
2. **Core** — catalog, GitHub client, scanner, AI dispatch, validation, tests.
3. **Worker** — Hono routes, SSE pipeline, Workflow.
4. **UI** — header, tabs, pipeline DAG + terminal, gaps, diff, PRs, settings.
5. **Verification** — `bun test`, `bun check`, `vite build`, manual dev run.
6. **Delivery** — README, AGENTS.md, VitePress docs site, CI + deploy workflows.
7. **Interfaces** — CLI and stdio MCP server over the shared API client.

### Status

The seven foundation phases and every planned feature (0.1 through 4.6) are
implemented, plus the Cloudflare Sandbox bridge and inferred-OpenAPI health
matrix. Tests live in each workspace's `test/` directory (never beside the
sources) and are included in `bun run check`. The dashboard was smoke-tested
against `wrangler dev`: health, catalog, asset serving, input validation, a real
repository scan, and the SSE error/result contract. Remaining and incomplete
work is tracked in `TASKS.md`, not here.

Deliberately not built:

- Authenticated user accounts and multi-user workspaces — there is one lazy
  `default` workspace, no membership or roles.
- A VS Code extension — only `edgespec watch` shipped.
- Coverage percentages — coverage is only a fact from an executable LCOV
  report, never inferred from the path heuristic.
- KV caching — add it only if repeated scans of the same commit become a cost
  problem.
- Cloudflare Queues — the cron and synchronous paths handle current volume.

---

## 13. Verification & deployment

```bash
bun install
bun test                 # discovers /test
bun run typecheck        # includes /test
bun run build
bun run check            # format + lint + types + tests
bun run docs:build       # static docs site
bun run docs:dev         # http://127.0.0.1:5174
bun run dev:worker       # http://127.0.0.1:8787
bun run dev              # http://127.0.0.1:5173 (proxies /api)
bun run sandbox          # http://127.0.0.1:8788
bun --silent run cli -- --help
bun run mcp -- --help
```

GitHub Actions:

- `ci.yml` — `bun install --frozen-lockfile`, `bun run check`, `bun run build`,
  `bun run docs:build`.
- `deploy.yml` — builds and deploys `main`; needs `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` repository secrets.

Deploy manually:

```bash
bunx wrangler login
bun run deploy
```

Optional secrets for the webhook/automation path:

```bash
bunx wrangler secret put GITHUB_APP_ID
bunx wrangler secret put GITHUB_APP_PRIVATE_KEY
bunx wrangler secret put GITHUB_TOKEN             # fallback when no App
bunx wrangler secret put GITHUB_WEBHOOK_SECRET
bunx wrangler secret put SANDBOX_RUNNER_URL
bunx wrangler secret put SANDBOX_API_KEY
bunx wrangler secret put DRIFT_WEBHOOK_URL
bunx wrangler secret put DRIFT_WEBHOOK_SECRET
```

For an all-Cloudflare runner, deploy the Sandbox bridge and point the main
Worker at it:

```bash
bun run deploy:sandbox-worker
cd apps/sandbox-worker && bunx wrangler secret put SANDBOX_API_KEY
# Then set SANDBOX_RUNNER_URL to the bridge URL and the same SANDBOX_API_KEY
# on the main Worker.
```

Optional D1 setup:

```bash
bunx wrangler d1 create edge-spec-runs
bunx wrangler d1 migrations apply edge-spec-runs --remote
# Uncomment the RUNS_DB block in wrangler.toml, then deploy.
```
