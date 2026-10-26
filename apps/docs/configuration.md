# Configuration

EdgeSpec has two configuration surfaces:

1. **Project selector** — repository and branch, chosen directly in the header.
   Stored separately from Settings and sent per request.
2. **Browser settings** — provider, model, secrets, pipeline knobs, appearance.
   Sent per request; never stored by the deployment.
3. **Deployment configuration** — Cloudflare bindings, optional secrets for the
   webhook/automation path, and the optional sandbox runner.

## Project selector

Enter `owner/name` in the header. The branch dropdown is fetched from GitHub
once a repository is committed; the default branch is selected automatically.
While the input is being edited the branch control collapses away, so it always
reflects the saved repository; it returns when the new value is committed. An
optional folder path — `owner/name/src/app` or a GitHub tree URL — starts the
dashboard in that folder, but the scan and the pipeline still cover the whole
repository. The branch dropdown is replaced by a read-only chip in that mode; a
tree URL, or clearing the folder, chooses the branch. Both the repository and
branch are required for a pipeline run, and there is no server-side default.

On localhost the input also accepts a filesystem path: `C:\code\app`,
`/home/me/app`, `~/app` or `./app`. The Vite dev server serves the read-only
scan and file reads from that folder; nothing leaves the machine. Local
projects support scan and per-file generation. The pipeline and pull request
still need a GitHub repository.

| Value      | Default   | Effect                                                                |
| ---------- | --------- | --------------------------------------------------------------------- |
| Repository | _(empty)_ | `owner/name`; required for the pipeline and pull request              |
| Folder     | _(none)_  | Start folder; only changes the order, never the scan scope            |
| Local path | _(none)_  | Localhost only; scan and generate from a folder on this machine       |
| Branch     | default   | Ref used for tree, file reads, and as the PR base; a tree URL sets it |

## Browser settings

Open **Settings** in the header for everything except the repository.

| Setting                 | Default                                    | Effect                                                                |
| ----------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| Provider                | `workers-ai`                               | See the provider table                                                |
| Model                   | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | A catalog model, or free text for the custom provider                 |
| Base URL                | _(empty)_                                  | Custom provider only                                                  |
| Cloudflare account ID   | _(empty)_                                  | Optional; Workers AI BYOK with an API token                           |
| GitHub token            | _(empty)_                                  | Private repos, higher rate limits, branches/commits/PRs               |
| AI key                  | _(empty)_                                  | Required for known providers; optional (BYOK) for the custom provider |
| Coverage target         | `90`                                       | Advisory prompt goal, 0–100 (clamped)                                 |
| Self-correction retries | `2`                                        | 0–5 (clamped)                                                         |
| Parallel generation     | on                                         | Generate several tests side by side when more than one is picked      |
| Files per run           | `10`                                       | How many gap files one pipeline run covers, 1–50 (clamped)            |
| Files in flight         | `3`                                        | Per-file tasks in one run, 1–6 (clamped; a sandbox cap wins)          |
| Test runner URL         | _(empty)_                                  | A runner you own that executes the suite, so validation is a real run |
| Strict TypeScript       | on                                         | Reject `any`, `as any` and `@ts-ignore`-style suppressions            |
| Appearance              | dark / indigo                              | Immediate theme and accent                                            |

### Storage keys

| Key                     | Purpose                                         |
| ----------------------- | ----------------------------------------------- |
| `edgespec:project`      | Repository, branch, start folder and local path |
| `edgespec:settings`     | JSON of the non-secret settings above           |
| `edgespec:github-token` | GitHub token                                    |
| `edgespec:ai-key`       | Provider key                                    |
| `edgespec:sandbox-key`  | Key for your own test runner                    |
| `edgespec:theme`        | `dark` or `light`                               |
| `edgespec:accent`       | Accent base hex                                 |

Settings save on **Save settings** (appearance applies immediately). **Forget
saved keys** clears both secrets. Corrupt or unavailable `localStorage` falls
back to defaults; private browsing may keep values for the session only.

### Secret transport

Non-secret settings live in the JSON body. Secrets travel as headers:

```text
x-github-token: ghp_…
x-ai-key: sk-…
x-ai-base-url: http://localhost:11434/v1
x-sandbox-url: https://runner.example.com
x-sandbox-key: runner-key
x-deployment-ai: 1
```

`x-ai-base-url` is only attached when the provider is `private` (the custom
provider). The Worker forwards the key to the chosen provider and does not log
or persist it.

`x-sandbox-url` and `x-sandbox-key` are only attached when **Test runner URL**
is set in Settings. They point the Worker at a runner you own, so the generated
suite is executed instead of only checked statically.

`x-deployment-ai` asks the Worker for its own Workers AI binding. The dashboard
only sends it while developing locally, so a deployed Worker never spends the
owner's quota for a visitor.

> Keys in `localStorage` are readable by any script on the origin. This is a
> single-user tool, not a multi-tenant secret store. Use short-lived keys, and
> **Forget saved keys** on shared machines.

## Providers

| ID           | Name                  | Protocol                 | Key      | Base URL                                    |
| ------------ | --------------------- | ------------------------ | -------- | ------------------------------------------- |
| `workers-ai` | Cloudflare Workers AI | Binding or OpenAI REST   | Optional | Binding `AI`, or your account + token       |
| `openai`     | OpenAI                | OpenAI                   | Yes      | `https://api.openai.com/v1`                 |
| `anthropic`  | Anthropic             | Anthropic Messages       | Yes      | `https://api.anthropic.com`                 |
| `google`     | Google Gemini         | Gemini `generateContent` | Yes      | `https://generativelanguage.googleapis.com` |
| `groq`       | Groq                  | OpenAI                   | Yes      | `https://api.groq.com/openai/v1`            |
| `deepseek`   | DeepSeek              | OpenAI                   | Yes      | `https://api.deepseek.com/v1`               |
| `mistral`    | Mistral               | OpenAI                   | Yes      | `https://api.mistral.ai/v1`                 |
| `openrouter` | OpenRouter            | OpenAI                   | Yes      | `https://openrouter.ai/api/v1`              |
| `private`    | Custom provider       | OpenAI-compatible        | Optional | Your URL                                    |

Models offered in Settings come from `packages/core/src/catalog.ts`. The Worker rejects a
model that is not in the selected **known** provider's list, so changing the
catalog is the only way to add one. The custom provider accepts any model name.

### Cloudflare Workers AI BYOK

On a deployed Worker, Workers AI runs on **your** Cloudflare account: add both
a 32-character account ID and a Cloudflare API token in Settings. The Worker
then calls Cloudflare's OpenAI-compatible endpoint:

```text
POST https://api.cloudflare.com/client/v4/accounts/<account-id>/ai/v1/chat/completions
Authorization: Bearer <cloudflare-api-token>
```

Both values are required, and they belong together: the account ID says which
Cloudflare account, the API token proves it. Filling in one without the other
is refused with a clear message. The deployment's `AI` binding is a local
development convenience: the dashboard only asks for it with `x-deployment-ai`, which it
sends on localhost only. A deployed Worker without your own account fails with
a clear message. The token travels in `x-ai-key`; the account ID is non-secret
and travels in the request body. Webhook automation remains binding-only.

### Custom provider (BYOK)

Any OpenAI-compatible endpoint works: vLLM, Ollama, LiteLLM, an internal
gateway, or a hosted provider that is not in the catalog. Add your own key in
Settings; it stays in the browser and travels per request.

The Worker calls:

```text
POST <baseUrl>/chat/completions
Authorization: Bearer <key>      (only if a key is set)
```

Rules:

- The URL must parse and use `http:` or `https:`. A trailing `/` is stripped.
- The model name is free text and required.
- The key is optional, so local servers with no auth work.
- A base URL supplied for any other provider is ignored by the Worker. This
  prevents a request from redirecting a real provider key to an arbitrary host.
- The Worker must be able to reach the URL. A `localhost` URL only works when
  the Worker runs on that network; a deployed Worker cannot reach your laptop.

### Workers AI

The deployment needs an `AI` binding (present in `wrangler.toml`). It is the only
provider that needs no user key. Workers AI always executes remotely, so local
`wrangler dev` may report the binding as unsupported until you are logged in and
using remote resources. For local UI work, an OpenAI-compatible provider or the
custom path is simpler.

## Pipeline knobs

| Knob                 | Default | Bounds  | Notes                                                                  |
| -------------------- | ------- | ------- | ---------------------------------------------------------------------- |
| `coverageTarget`     | 90      | 0–100   | Coverage threshold; with a runner, files below it are `coverage` gaps  |
| `maxRetries`         | 2       | 0–5     | Extra generations after a failed validation                            |
| `parallelGeneration` | true    | boolean | Generate the picked tests in parallel instead of one by one            |
| `maxFiles`           | 10      | 1–50    | How many gap files one pipeline run generates a test for               |
| `maxTokens`          | 0       | 0–2M    | Provider-reported token cap for one run; `0` means no cap              |
| `flakyRuns`          | 2       | 0–5     | Extra repeats after a passing suite; `0` disables flaky detection      |
| `mutationCommand`    | empty   | ≤500    | Stryker-compatible command; empty means mutation is not measured       |
| `propertyTests`      | false   | boolean | Opt-in fast-check properties with 50 runs and seed 42                  |
| `autoRouteModels`    | false   | boolean | Cheap models for small first attempts, strong for failures/large files |
| `concurrency`        | 3       | 1–6     | Files generated and validated at once; a lower sandbox cap wins        |
| `strictTypes`        | true    | boolean | Rejects explicit `any`, `as any`, and TS suppression comments          |

Bad values are clamped, not rejected. `strictTypes` and `parallelGeneration`
default to true
unless the request explicitly sends `false`.

Before generation the run logs an estimated **input-token range** for the loaded
files. That estimate is not a bill. When `maxTokens` is set, the run counts only
the token usage the provider reports; once the cap is reached it finishes the
current file, starts no new files, and returns the tests that are ready with
`result.ok: false`. If a provider reports no usage, the log says the cap could
not be enforced. On a quota or 5xx response the Worker retries once with the
next model of the same provider and logs the fallback; a failed call never
contributes a cost.

A passing suite is repeated `flakyRuns` times. If any repeat fails on the same
input, the result is `flaky: true`, `ok: false`, `verified: false`; it is
quarantined in Review and labelled in the PR body instead of being counted as a
pass. This can multiply runner time, so `0` turns it off. The same command and
environment are reused; there is no per-run seed control yet.

Property tests are opt-in and only run when `fast-check` is already a dependency
in `package.json`. The prompt asks for a `[property]`-labelled test with
`fc.assert(..., { numRuns: 50, seed: 42 })`; static validation rejects a missing
import, label, bound or seed, so the correction loop can fix it. fast-check’s own
failure output carries the seed and counterexample. Off by default because the
extra runs cost real runner time and can expose real flakiness.

Mutation is opt-in through `mutationCommand`. `{file}` and `{test}` are
shell-quoted and substituted. The command runs only after a stable pass, in the
same runner and with the same files. It reads a Stryker JSON report from
`mutation.json` or `reports/mutation/mutation.json`; killed/survived counts and
the command are kept. A missing tool, missing report or non-JSON output is
**not measured** — never a score. A runner timeout is labelled `budget stop`.
The command and the report path are visible in the review dialog and PR body.

A run covers the first `maxFiles` gaps, highest risk first, and every test it
writes waits in **Review** for a pull request. Files run through a bounded pool:
`ready` stays in scan order even though events interleave, and each event names
its `sourcePath`. One file that exhausts its retries fails alone.

## Model routing and eval

`autoRouteModels` is opt-in. Small first attempts go to the cheapest tier,
retries and sources over 8,000 characters go to the strongest, and the middle
tier handles the rest. Tiers are catalog hints, not a measured quality score,
and the user’s single-model choice is kept when routing is off.

`bun run eval` compares the local golden cases in `evals/golden.json` with the
scanner’s gaps. If `evals/outcomes.json` exists, it also prints verified,
acceptance and flake rates plus measured average tokens per provider/model. The
harness never invents cost: token averages appear only for outcomes that
reported tokens.

## Test runners

The runner is detected per repository, in this order: Playwright
(`@playwright/test` or `playwright.config.*`), Vitest (`vitest` or
`vitest.config.*`), Jest (`jest`/`ts-jest` or `jest.config.*`), then Bun
(`bun:test`) as the fallback. The prompt imports from that runner, and validation
runs the matching command with the repository's package manager
(`bunx vitest run …`, `npx jest … --runInBand`, `npx playwright test …`, or
`bun test …`). The dashboard's Facts dialog shows the detected runner. The
runner must be installed in the sandbox; static validation still works without a
runner but cannot claim an execution.

## Cloudflare Sandbox runner

`apps/sandbox-worker` is a Cloudflare Worker plus Container that speaks the
same `/health` and `/run` contract. It is the recommended runner for a
Cloudflare deployment: the container image is built by Wrangler, and the
dashboard only needs its URL and key.

```bash
bun run deploy:sandbox-worker
cd apps/sandbox-worker
bunx wrangler secret put SANDBOX_API_KEY
```

Then set the main Worker's secret `SANDBOX_RUNNER_URL` to the bridge URL and
`SANDBOX_API_KEY` to the same key. `/health` reports `provider: "cloudflare"` and
`isolation: "container"`. The bridge refuses `/run` when its key is missing, so
a misconfigured deployment cannot execute code for anonymous callers. It clones
only `https` repositories, keeps a supplied token in `GIT_TOKEN` rather than the
command line, and destroys the sandbox after every request.

Drivers E2B, Vercel Sandbox, Daytona, Docker, Podman and bwrap still work when
you point the dashboard at the self-hosted runner; they are alternatives, not
requirements. `bun run sandbox` remains the local/self-hosted runner.

## Contract auth fixtures

Settings holds two optional JSON objects per environment: auth headers and auth
query values. They travel with the run, are injected into the sandbox as
`EDGESPEC_AUTH_HEADERS` and `EDGESPEC_AUTH_QUERY`, and are never embedded in
generated code, events, run history, logs or the PR. A secured operation is
skipped with “no auth fixture was configured” until a fixture exists, then it
runs normally.

Generated contract tests also send an unauthenticated request where security is
declared (expecting 401/403) and, with a JSON body example and required schema
fields, a missing-field and wrong-type request (expecting a documented 4xx or
400/422). These are deterministic extras, not AI output.

## API fixtures (record/replay)

`POST /api/record` runs the contract suite against a booted app once and returns
a versioned fixture file. Passing that file as `fixtures` to `/api/run` makes the
generated contract tests start a tiny in-test mock server from
`EDGESPEC_FIXTURES`; no live app is required. The mock serves the recorded
status, headers and body, and the normal status assertion still runs, so a
deliberate spec status change fails replay. Recorded bodies may contain real
data: keep them outside the PR, preferably in R2, and apply retention there.

## Run history, backlog and D1 (optional)

Run history, the test-debt backlog, policies, repository memory, schedules,
workspace settings and audit live in one optional D1 database (`RUNS_DB`). This
repository's `wrangler.toml` binds a database named `edge-spec-runs`; create
and migrate it before deploying to another account:

```bash
bunx wrangler d1 create edge-spec-runs
bunx wrangler d1 migrations apply edge-spec-runs --remote
# For local development:
bunx wrangler d1 migrations apply edge-spec-runs --local
```

Without the binding the Worker still scans, generates and opens pull requests,
but `/api/runs`, `/api/backlog`, `/api/workspace` and `/api/audit` answer
`enabled: false` and the cron does nothing. The tables store summaries, not
source text, prompts or keys.

`wrangler dev` uses its own local database under `.wrangler/state`, so remote
migrations do not create tables there. A `D1_ERROR: no such table: runs` (or
`backlog_items`) on localhost means the local copy is empty: run
`bun run db:migrate:local`. It is harmless to repeat — applied migrations are
skipped. `bun run dev:worker` runs it automatically; `bun run db:migrate`
applies the same migrations to production.

## Repository memory (optional)

With `RUNS_DB`, a repository can opt into a small memory of approved
conventions, helper paths, fixture paths and test naming. Only short strings are
stored; source text is never retained by this feature. The memory is loaded into
dashboard generation, single-file generation, and webhook prompts, and every
generation is stamped with `PROMPT_VERSION` so results can be attributed. Manage
it at `GET/PUT/DELETE /api/memory?repo=owner/name`.

## Pull request policy (optional)

Dashboard policy lives in `localStorage` (Settings → Policy) and travels with
the pull request request. CI policy is opt-in server data in the same D1
database as run history (`PUT /api/policies?repo=owner/name`). No policy entry
means no extra gates.

| Gate               | Behaviour                                                        |
| ------------------ | ---------------------------------------------------------------- |
| Kill switch        | Blocks every pull request                                        |
| Draft only         | Requires a draft pull request for human approval                 |
| Max files          | Blocks a batch larger than the limit                             |
| Allowed test paths | Glob allowlist; every test path must match                       |
| Min coverage delta | Requires measured, non-negative covered lines to reach the floor |
| Labels / reviewers | Applied after opening; never fails the pull request              |

A violation blocks before any branch or commit exists, and the API returns the
gate name and reason. The dashboard shows that error in the pull request
dialog. The webhook workflow enforces the server policy and returns
`status: "blocked"` without opening a pull request.

## Test impact graph

PR checks and `/edgespec retest|coverage` fetch test files and their relative
imports (up to 200 files, six at a time) and walk reverse edges to find direct
and transitive test dependents of the changed files. The selected tests and
their import chains appear under **Impact** in the check summary, and the same
answer is at `POST /api/impact`. The graph is cached per `repo@ref` in the
isolate; a bounded or unreadable fetch is labelled `partial`, never “no
dependents”. Regex parsing covers static/export/require/dynamic imports and
relative paths only. Package aliases and tsconfig path mappings are not
resolved yet.

## Test-debt backlog (optional)

With `RUNS_DB`, scans maintain a durable backlog instead of a transient list.
Each gap stores its kind, risk reason, first/last seen, linked run (when the
pipeline supplied one), state, and owner. `CODEOWNERS` is read from the root,
`.github/` or `docs/` and the last matching rule owns the item. If the gap
disappears in a later full scan, the item is `closed`; if it returns, it reopens
as `open`. Human decisions (`accepted`, `rejected`, `ignored`) are preserved.

The dashboard has a **Test-debt backlog** button beside History. The same data
is available at `GET/PATCH /api/backlog?repo=owner/name`. Without `RUNS_DB`,
scans keep working and the backlog is simply unavailable.

## Scheduled drift scans (optional)

`wrangler.toml` registers a daily cron (`0 8 * * *`). Per-repository schedules
live in D1 (`PUT /api/schedules?repo=owner/name`), with a 1–30 day interval and
an optional App installation id. A scan compares untested paths and OpenAPI
operation names with the stored snapshot:

- first run: baseline only;
- no change: no notification, no pull request;
- change: one summary to `DRIFT_WEBHOOK_URL` (Slack incoming webhooks accept
  `text`) and optionally `drift/<repo>/<timestamp>.json` in R2.

```bash
bunx wrangler secret put DRIFT_WEBHOOK_URL
bunx wrangler secret put DRIFT_WEBHOOK_SECRET   # sent as x-edgespec-secret
```

There is no email adapter yet. Without `RUNS_DB` the cron does nothing, and
without `DRIFT_WEBHOOK_URL` drift is still recorded but not announced. The scan
never opens a pull request; PR creation remains the explicit next step.

## Workspace, audit and retention (optional)

A deployment has one workspace record (`GET | PUT /api/workspace`), created
lazily as `default` on first use. This is deliberately not multi-user auth:
shared policies, backlog and history live in the same D1 database, and every
client still supplies its own GitHub and AI credentials per request. The
workspace stores only a display name and a retention window; it never stores a
key.

Actions that change shared state or act autonomously write an audit event:
pull requests opened or blocked, PR checks and commands, policy/memory/schedule/
backlog updates, workspace updates, drift scans and retention purges. Read them
with `GET /api/audit?repo=owner/name`. Detail is redacted recursively for
token/key/secret/password/authorization/cookie keys before storage, so audit
rows are safe to share with the team.

The daily cron applies retention before scanning:

- runs and their `run_files` rows older than `retentionDays` are deleted;
- audit events older than `retentionDays` are deleted;
- `pr_commands` rate-limit rows older than `retentionDays` are deleted.

Retention is clamped to 1–365 days (default 30). A purge writes one
`retention_purge` event with the deleted counts. There is no per-repository
retention override and no export or archive step; R2 artifacts are not deleted
by this job.

## Sandbox runner (optional)

A runner executes the generated suite, so the result is a real pass or fail
instead of a static check. Without one, the dashboard shows **static check
only** and `validation.verified` is false. A runner is the security boundary:
generated tests and repository code are untrusted, so run them in a hosted
microVM or on Linux under `bwrap`—never directly on the Worker or a shared host.

There are two ways to point at a runner:

1. **Settings → Sandbox.** The URL travels in the `x-sandbox-url` header, its key
   in `x-sandbox-key`, and the non-secret knobs in one `x-sandbox-config` JSON
   header. The Worker calls it, so it has to be reachable from it;
   `http://localhost` only works with a Worker running on your own machine. A
   deployed Worker rejects loopback and private targets.
2. **Deployment defaults.** `SANDBOX_RUNNER_URL` and `SANDBOX_API_KEY` are used
   when the request carries no runner of its own. Caller config wins.

`x-sandbox-config` accepts `provider` (`auto`, `docker`, `podman`, `bwrap`,
`e2b`, `vercel`, `daytona` or `custom`), `setup` (commands, one per line in the
UI), `env` (`KEY=VALUE`), `server` (`command`, `readyUrl`, `timeoutMs`),
`timeoutMs` (clamped 10 s – 10 min), `concurrency` (1–4), `coverage`, `cwd`,
`allowRepoToken` and `v2`.
Unknown fields, bad types and escaping paths are rejected with a `400` naming
the field; validation lives in `packages/core/src/sandbox.ts`.

The Settings picker is scoped to where the dashboard runs. Under the Vite dev
server (`bun run dev`) it lists `docker`, `podman` and `bwrap` next to the
hosted drivers; the Worker lists only `auto`, `e2b`, `vercel`, `daytona` and
`custom` — including `wrangler dev` on localhost, which serves the built
assets — and a stored local driver is reset to `auto`. The runner itself still
accepts every id, so the header contract is unchanged.

A named `provider` is an assertion: it travels as `x-sandbox-provider`, and a
runner using another driver refuses the request instead of silently running it
elsewhere. `auto` and `custom` assert nothing. The runner's `/health` reports
`provider` and `isolation` (`namespace`, `container`, `vm` or `none`), and the
Settings dialog hides the app and coverage knobs a tested runner does not
support.

### The contract

A plain `{files, command}` body stays v1, so an existing runner keeps working.
Any v2 feature upgrades the request:

```json
{
  "v": 2,
  "repo": { "url": "https://github.com/acme/api.git", "ref": "main" },
  "files": { "src/math.test.ts": "…" },
  "cwd": "packages/api",
  "setup": ["bun install --frozen-lockfile"],
  "env": { "NODE_ENV": "test" },
  "server": { "command": "bun run dev", "readyUrl": "http://127.0.0.1:3000/health" },
  "coverage": { "format": "lcov" },
  "command": "bun test",
  "timeoutMs": 180000
}
```

The runner replies with `exitCode`, `stdout`, `stderr`, the request `files` read
back (so a formatter can return its work), `artifacts` and, when it parsed the
report, `coverage`:

```json
{
  "exitCode": 0,
  "stdout": "…",
  "files": { "src/math.test.ts": "…formatted…" },
  "artifacts": { "coverage/lcov.info": "SF:src/math.ts\nDA:1,1\nend_of_record\n" },
  "coverage": { "lines": { "covered": 42, "total": 50 }, "files": [] }
}
```

`setup` runs sequentially and stops on failure. A failed clone, setup or app
boot is `environmentError: "setup" | "server"`; a killed run is `timedOut`.
Neither is a failed test, and neither is ever reported as passed. Coverage is
read from `coverage/lcov.info` (or the runner's parsed field); with no report the
result is “not measured”, never 0 %.

### The deployment's own runner

The repository ships `packages/sandbox`, a reference runner with no Dockerfile. It
is a Bun HTTP service that runs each request in a `bwrap` namespace, or in a
Docker Desktop / Podman container when that is all the machine has:

```bash
bun run sandbox                                  # 127.0.0.1:8788, auto-detect
SANDBOX_PROVIDER=docker bun run sandbox          # Docker Desktop
SANDBOX_PROVIDER=podman SANDBOX_IMAGE=node:22 bun run sandbox
```

`auto` prefers `bwrap`, then Docker, then Podman. Containers pull an existing
image (`oven/bun:1` by default); the repository still has no Dockerfile. A
container gets its own network and a published port for the app's readiness
URL; `bwrap` stays the stronger boundary because its network is empty unless
`SANDBOX_ALLOW_EGRESS=1`.

Hosted providers are the same runner with `SANDBOX_PROVIDER=e2b|vercel|daytona`
and their key in the runner's environment. Install the SDK first
(`bun add e2b`, `bun add @vercel/sandbox`, or `bun add @daytona/sdk`, all with
`--cwd packages/sandbox`). Vercel also needs `VERCEL_TEAM_ID` and
`VERCEL_PROJECT_ID`; Daytona reads `DAYTONA_API_KEY` (plus optional
`DAYTONA_API_URL`, `DAYTONA_TARGET`, `DAYTONA_SNAPSHOT`). Keys are never part of
the request, the dashboard config or the Worker. These providers own the
filesystem, so the runner uploads the workspace and downloads the requested
files; `isolation` is reported as `vm`.

Point a local Worker at it with `SANDBOX_RUNNER_URL=http://127.0.0.1:8788`, or
put it behind TLS and a key for a deployment. `POST /api/sandbox/health`
proxies the runner's `/health`; the Settings dialog has a **Test connection**
button for it. See `packages/sandbox/README.md` for limits, egress and
authentication.

### Your own runner

Any endpoint that speaks the contract above works: pick **Custom runner** in
Settings and give its URL and key. Two routes are enough:

- `GET /health` → `{ ok, version, capabilities, provider, isolation }`. List
  only what the runner really does: `server` if it boots the app and waits for
  `readyUrl`, `coverage` if it reads `coverage/lcov.info`, `repo` if it clones.
  Settings hides the knobs a runner does not list.
- `POST /run` → the reply above. The key arrives as
  `authorization: Bearer <key>`.

`packages/sandbox` is the reference implementation of both routes;
`packages/sandbox/custom-runner.example.ts` is a small runnable one that shells out
to `docker run` and mounts the workspace. Copy either, or put a queue, a CI
job or a hosted API behind the same two endpoints. Report `isolation` truthfully
(`namespace`, `container`, `vm` or `none`): it is shown next to the result, so a
runner without a boundary must say `none`. Generated code is untrusted — run it
inside a boundary, never on the runner's host.

### The repository's own checks

EdgeSpec reads the commands the repository runs — the scripts of
`package.json` and the `run:` steps of `.github/workflows/*.yml` — and runs
them against the generated test, so CI does not fail on a file the model
wrote:

| Command       | What it does                                                    |
| ------------- | --------------------------------------------------------------- |
| the formatter | rewrites the generated file with the repository's own formatter |
| lint          | the lint command of the manifest or the workflow                |
| typecheck     | the type check command                                          |
| build         | the build command                                               |
| test          | the test command, besides `bun test` on the generated file      |

A failing check fails the validation, and the failure output is fed back into
the self-correction loop, so the model gets a second attempt with the exact
error. A check whose tool is missing in the runner is reported as _not
runnable here_, never as a pass.

The runner may also return the files it ended up with, which is how the
formatter hands back the formatted code:

```json
{ "exitCode": 0, "stdout": "…", "files": { "src/math.test.ts": "…formatted…" } }
```

Without that field the formatter step cannot rewrite the file, and the format
check catches the difference instead.

`exitCode === 0` → `ok: true, verified: true`. A non-2xx response or an
unreachable runner → `verified: false` with `environmentError`. A check whose
tool is missing is `skipped`, never a pass.

## Deployment

`wrangler.toml`:

```toml
name = "edge-spec"
main = "dist/worker/index.js"
compatibility_date = "2025-07-18"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "dist/web"
binding = "ASSETS"
not_found_handling = "single-page-application"

[ai]
binding = "AI"

[[workflows]]
name = "test-generation-workflow"
binding = "TEST_GENERATION_WORKFLOW"
class_name = "TestGenerationWorkflow"
```

`bun run build` must run before `wrangler deploy`; Wrangler uploads the bundles,
not the TypeScript sources.

### Secrets

| Secret                   | Required              | Used by                              |
| ------------------------ | --------------------- | ------------------------------------ |
| `GITHUB_APP_ID`          | For App auth          | Mint installation tokens             |
| `GITHUB_APP_PRIVATE_KEY` | For App auth          | PKCS#8 PEM used to sign the app JWT  |
| `GITHUB_TOKEN`           | Fallback for webhooks | Workflow: scan, commit, PR           |
| `GITHUB_WEBHOOK_SECRET`  | Recommended           | `POST /webhook` HMAC verification    |
| `SANDBOX_RUNNER_URL`     | No                    | Validation, interactive and workflow |
| `SANDBOX_API_KEY`        | No                    | Bearer token for the sandbox         |

```bash
bunx wrangler secret put GITHUB_APP_ID
bunx wrangler secret put GITHUB_APP_PRIVATE_KEY
bunx wrangler secret put GITHUB_WEBHOOK_SECRET
bunx wrangler secret put GITHUB_TOKEN
bunx wrangler secret put SANDBOX_RUNNER_URL
bunx wrangler secret put SANDBOX_API_KEY
```

With both App secrets set, a webhook run mints a short-lived installation token
scoped to the repository. Tokens are cached in the isolate only until a minute
before GitHub expires them; a restart costs one mint request. Without the App
secrets, the workflow falls back to `GITHUB_TOKEN`.

The interactive dashboard does **not** use either deployment credential; it
uses the token from the browser. The deployment credentials exist for webhook
runs and must never be sent to a workflow as parameters (Workflow parameters are
persisted). The installation id is not a secret and is passed instead.

### GitHub token permissions

- Classic token: `repo` for private repositories; `public_repo` is enough for
  public repositories.
- Fine-grained token: **Contents: read and write**, **Pull requests: read and
  write** on the target repositories.
- Read-only browsing can work with no token; pushing and opening PRs cannot.

### Webhook setup

1. Repository **Settings → Webhooks → Add webhook**.
2. Payload URL: `https://<worker>/webhook`.
3. Content type: `application/json`.
4. Secret: the same value as `GITHUB_WEBHOOK_SECRET`.
5. Events: **push**, **pull request** (`opened`, `synchronize`, `reopened`), and
   **issue comments** (for `/edgespec retest|coverage|explain`).
6. Use the GitHub App installation, or ensure `GITHUB_TOKEN` can write to the
   repository, and keep Workers AI bound.

For App auth, install the app on the repository, subscribe the app to pushes
and pull requests, and set the app's webhook secret to
`GITHUB_WEBHOOK_SECRET`. The app needs **Contents: read and write**,
**Pull requests: read and write**, **Checks: read and write**, and
**Issues: read and write** (for policy labels).

A pull request run is a read-only advisory check: changed-file gaps, affected
tests if a runner exists, one check and one comment. Re-runs update both.

Runs are durable and can be polled at `GET /api/runs/:id` with the `workflowId`
returned by the webhook.

## GitHub Actions

`.github/workflows/ci.yml` runs on every push and pull request:

```text
bun install --frozen-lockfile
bun run check
bun run build
```

No Cloudflare credentials are needed. `.github/workflows/deploy.yml` deploys
`main` (or a manual dispatch) and requires repository secrets:

| Secret                  | Value                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Token that can upload Workers scripts (Workers Scripts: Edit); the deploy includes the AI and Workflow bindings |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id                                                                                           |

Deploy manually:

```bash
bunx wrangler login
bun run deploy
```

## Local development

```bash
bun install
bun run dev:worker     # built Worker + API on :8787
bun run dev            # Vite on :5173, proxies /api to :8787
```

Run both for dashboard development. `bun run dev:worker` serves the last built
assets, so rebuild (`bun run build:web`) after UI changes if you are not using
Vite. The Worker bundle must be rebuilt after `packages/core/src` or `apps/worker/src` changes
(`bun run build:worker`) because Wrangler loads `dist/worker/index.js`.
