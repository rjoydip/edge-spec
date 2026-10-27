# API reference

Base URL: the Worker origin (`https://<worker>` or `http://127.0.0.1:8787`).
All request and response bodies are JSON unless noted. SSE is used only by
`POST /api/run`.

## Conventions

### Headers

| Header                           | Used by                                            | Purpose                                                                                       |
| -------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `content-type: application/json` | all POST routes                                    | Required for JSON parsing                                                                     |
| `x-github-token`                 | scan, branches, run, generate, pull-request, pulls | Optional GitHub token. Needed for private repos and higher rate limits                        |
| `x-ai-key`                       | run, generate                                      | Provider key. Required by known providers; optional for Workers AI and the custom provider    |
| `x-ai-base-url`                  | run, generate                                      | Base URL for the custom provider (`private` id) only. Ignored for known providers             |
| `x-sandbox-url`                  | sandbox health, run, generate                      | A test runner you own; it executes the suite instead of a static check                        |
| `x-sandbox-key`                  | sandbox health, run, generate                      | Key for that runner                                                                           |
| `x-sandbox-config`               | sandbox health, run, generate                      | JSON knobs for that runner: provider, setup, env, server, timeout, concurrency, coverage, cwd |
| `x-deployment-ai`                | run, generate                                      | Asks for the deployment's Workers AI binding; the dashboard sends it on localhost only        |
| `x-hub-signature-256`            | webhook                                            | HMAC SHA-256 of the raw body, when a secret is configured                                     |

### Errors

Every non-streaming failure returns the same shape:

```json
{ "error": "Enter a repository as owner/name.", "status": 400 }
```

| Status | Meaning                                                                    |
| ------ | -------------------------------------------------------------------------- |
| 400    | Invalid input, missing key, bad model, bad base URL, provider auth failure |
| 401    | Invalid webhook signature                                                  |
| 404    | GitHub says the repo/path/ref does not exist, or the token cannot see it   |
| 501    | Feature not bound on this deployment (Workflows or Workers AI)             |
| 502    | GitHub or the AI provider is unreachable / returned an invalid response    |
| 500    | Unexpected error                                                           |

Unknown `/api/*` paths return JSON `404 {"error":"Not found"}` rather than the
SPA HTML.

---

## `GET /api/quota`

How many calls the current provider has left. The provider's models endpoint
answers with the same rate limit headers as a chat request, so the dashboard
can show the state without spending a completion.

```json
{ "rateLimit": { "provider": "openai", "limit": 10000, "remaining": 8431 } }
```

A provider that states no limit answers with `{}`. Nothing is guessed.

---

## `GET /api/health`

Liveness probe.

```json
{ "status": "ok", "app": "EdgeSpec", "timestamp": "2026-10-21T04:00:00.000Z" }
```

---

## `GET /api/catalog`

Everything the dashboard needs to render provider choices and defaults.

```json
{
  "providers": [
    {
      "id": "workers-ai",
      "name": "Cloudflare Workers AI",
      "protocol": "workers-ai",
      "needsKey": false,
      "models": [
        { "id": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "name": "Llama 3.3 70B Instruct" }
      ],
      "hint": "Runs on the deployment's Workers AI binding. No API key required."
    }
  ],
  "defaults": {
    "ai": { "provider": "workers-ai", "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
    "pipeline": {
      "maxRetries": 2,
      "autoPr": true,
      "strictTypes": true,
      "coverageTarget": 90,
      "parallelGeneration": true
    }
  },
  "sandbox": false
}
```

`sandbox` is `true` when the request supplies `x-sandbox-url` (or the operator
sets a deployment fallback). The dashboard uses it to avoid promising an
executed test.

---

## `POST /api/sandbox/health`

Probes a sandbox runner's `GET /health`. The Worker makes the request, so the
browser never has to reach an arbitrary origin and the key is not exposed to it.

```json
{ "url": "https://sandbox.example.com", "config": { "timeoutMs": 180000 } }
```

`url` may be omitted when `x-sandbox-url` supplies one. The key comes from
`x-sandbox-key`. On a deployed Worker, loopback and private targets are refused;
a local Worker may use `http://localhost`.

```json
{
  "ok": true,
  "version": "0.1.0",
  "capabilities": ["v2", "coverage", "server"],
  "provider": "docker",
  "isolation": "container"
}
```

`provider` is the driver the runner actually used, and `isolation` is
`namespace`, `container`, `vm` or `none`. A runner that was asked for another
driver answers `{ "ok": false, "error": "This runner uses docker, not podman." }`
instead of running the suite somewhere unexpected.

A runner that cannot be reached answers `{ "ok": false, "error": "…" }` with
status `200`; only invalid input is a `4xx`.

---

## `GET /api/branches?repo=owner/name`

Branch names for the header picker. The default branch is returned separately so
the dashboard can preselect it.

```json
{
  "branches": ["main", "dev", "release/1.x"],
  "defaultBranch": "main"
}
```

GitHub returns at most 100 branches for this call. A token is optional for public
repositories and required for private ones.

---

## `POST /api/scan`

Lists the source files that need a test, and describes the repository: the
languages, the package manager, the runtime, the versions and the frameworks
the configuration files reveal. Every fact is read from the tree; `package.json`
adds the name, version and engine range when it exists.

The scan separates four categories:

| Category      | Meaning                                                                            |
| :------------ | :--------------------------------------------------------------------------------- |
| `missing`     | Supported source file with no test in a sibling or ancestor test location          |
| `coverage`    | A test exists and a runner report says lines/branches fall short (needs a sandbox) |
| `api`         | An OpenAPI operation has no test named `METHOD /path`                              |
| `unsupported` | A language EdgeSpec cannot generate for yet (Python, Go, Rust, …); informational   |

Request:

```json
{ "repo": "honojs/hono", "ref": "main" }
```

`repo` accepts `owner/name`, a GitHub URL or a clone URL (validated down to
`owner/name`). `ref` defaults to `main`; branch names may contain letters,
digits, `. _ / -`, but not `..` or a leading `/`.

The `overview` also carries the commands the repository runs in CI, read from
the `package.json` scripts and the `run:` steps of `.github/workflows/*.yml`,
and the formatter it uses. A run measures the generated test against them.

When no OpenAPI document exists, the scan checks whether the repository is
API-based (Hono, Express, Elysia, Fastify, Koa, NestJS, Next.js, or route calls
in source). If it is, EdgeSpec infers a spec from route declarations, stores it
as `openapi.inferred.json`, and adds it to `overview.openApiSpecs` with
`inferred: true`. `overview.apiFramework` names the detected framework and
`overview.apiHealth` is the static endpoint matrix (`status` is `covered` or
`missing-test`, plus auth, request-body and parameter facts). The matrix is
built from the tree, not from live HTTP calls; no app is started by a scan.
Contract gaps from an inferred spec say so in their reason.

Response:

```json
{
  "repo": "honojs/hono",
  "ref": "main",
  "scanned": 583,
  "gaps": [
    {
      "path": "adapters/aws-lambda/src/index.ts",
      "testPath": "adapters/aws-lambda/src/index.test.ts",
      "risk": "medium",
      "exports": ["handler"],
      "reason": "No index.test.ts found next to this file or in an ancestor test directory.",
      "kind": "missing",
      "language": "TypeScript"
    }
  ],
  "coverageGaps": [],
  "apiGaps": [
    {
      "path": "openapi.yaml#GET /users/{id}",
      "testPath": "tests/api/openapi.contract.test.ts",
      "risk": "medium",
      "exports": [],
      "reason": "No contract test is named \"GET /users/{id}\".",
      "kind": "api",
      "evidence": {
        "specPath": "openapi.yaml",
        "operation": { "method": "GET", "path": "/users/{id}", "operationId": "getUser" }
      }
    }
  ],
  "unsupported": [],
  "totals": { "missing": 812, "coverage": 0, "api": 1, "unsupported": 0 },
  "truncated": { "missing": true, "coverage": false, "api": false },
  "coverageStatus": "not-run",
  "overview": {
    "languages": [{ "name": "TypeScript", "count": 412 }],
    "packageManager": "bun",
    "runtime": "node",
    "runtimeVersion": "20.11",
    "packageName": "hono",
    "packageVersion": "4.6.3",
    "frameworks": ["Bun", "TypeScript", "Cloudflare Workers"],
    "totalFiles": 583,
    "sourceFiles": 412,
    "testFiles": 96,
    "formatter": "prettier",
    "checks": [
      { "name": "lint", "kind": "lint", "command": "biome check ." },
      { "name": "test", "kind": "test", "command": "bun test" }
    ]
  }
}
```

Behaviour:

- `gaps` stays **missing-only** for old clients; `totals` carries every count.
- At most **25** missing gaps are returned; `truncated.missing` says so.
  The classifier itself has no silent 50-file cap.
- The first **8** are enriched with exported symbols and recalculated risk.
  Enrichment failures are cosmetic; the gap is still returned.
- `coverageStatus` is `not-run` here: the cheap scan never measures coverage.
  Only `POST /api/coverage` does, and it reports `measured` or `unavailable`
  with a reason. No report means "not measured", never 0 %.
- `risk` is a path heuristic, not a coverage measurement.
- A missing token works for public repositories, subject to GitHub's anonymous
  rate limit.

---

## `POST /api/impact`

Returns the changed files' direct and transitive test dependents and the import
chain that selected each one. It is the same bounded graph the PR check uses.

```json
{ "repo": "acme/api", "ref": "main", "changedPaths": ["src/util.ts"] }
```

```json
{
  "tests": [
    { "test": "src/auth.test.ts", "via": ["src/util.ts", "src/auth.ts", "src/auth.test.ts"] }
  ],
  "partial": false
}
```

`partial: true` means the 200-file fetch cap (or an unreadable file) cut the
graph short; it never means “no dependents”.

---

## `POST /api/record`

Records HTTP exchanges from a running app once, for later replay without it.
Requires a sandbox runner and the app origin.

```json
{
  "repo": "acme/api",
  "ref": "main",
  "specPath": "docs/openapi.yaml",
  "baseUrl": "https://staging.example.test",
  "authFixture": { "headers": { "Authorization": "Bearer …" } }
}
```

The route generates the deterministic contract suite, runs it with
`EDGESPEC_RECORD_FILE=recorded-fixtures.json`, and returns
`{enabled:true, specPath, fixtures}`. Fixture bodies are returned to the caller;
they are not logged or stored by the deployment. Pass the returned `fixtures` to
`POST /api/run` (or keep the JSON wherever CI can read it; R2 is recommended).

---

## `POST /api/coverage`

Runs the repository's own test command in a sandbox runner with coverage, and
classifies files whose tests exist but whose lines or branches fall short of
`coverageTarget`.

Request:

```json
{ "repo": "acme/api", "ref": "main", "coverageTarget": 90 }
```

Needs `x-sandbox-url`; without a runner the route returns `400`. Non-secret
knobs travel in `x-sandbox-config`, exactly as a run does. The test command comes from `package.json`/CI detection; EdgeSpec never
invents one.

Response:

```json
{
  "repo": "acme/api",
  "ref": "main",
  "scanned": 120,
  "coverageGaps": [
    {
      "path": "src/math.ts",
      "testPath": "src/math.test.ts",
      "risk": "medium",
      "exports": [],
      "reason": "uncovered lines 12-14, 31; line rate 64% vs target 90%. Extend src/math.test.ts.",
      "kind": "coverage",
      "evidence": {
        "testFiles": ["src/math.test.ts"],
        "lineRate": 64,
        "uncoveredLines": [12, 13, 14, 31]
      }
    }
  ],
  "totals": { "missing": 8, "coverage": 1, "api": 0, "unsupported": 0 },
  "truncated": { "missing": false, "coverage": false, "api": false },
  "coverageStatus": "measured"
}
```

A file with no test stays `missing`; coverage never re-labels it. If the runner
is unreachable, the suite fails, or no `lcov.info` comes back, the status is
`unavailable` with `coverageReason` from the runner — never a percentage.

---

## `POST /api/run`

Runs the pipeline over the configured number of gaps and streams progress as
SSE.

Request:

```json
{
  "repo": "acme/api",
  "ref": "main",
  "provider": "openai",
  "model": "gpt-6-astra",
  "accountId": "0123456789abcdef0123456789abcdef",
  "maxRetries": 2,
  "maxFiles": 10,
  "maxTokens": 0,
  "flakyRuns": 2,
  "mutationCommand": "npx stryker run --mutate {file}",
  "propertyTests": false,
  "authFixture": {
    "headers": { "Authorization": "Bearer …" },
    "query": { "api_key": "…" }
  },
  "concurrency": 3,
  "mode": "unit",
  "strictTypes": true,
  "coverageTarget": 90
}
```

`concurrency` is the number of files in flight, clamped `1–6` (default `3`); a
sandbox's own `concurrency` cap wins when it is lower. `mode` is `unit` (the
default), `api`, or `both`. API mode parses OpenAPI JSON/YAML specs, generates
deterministic contract tests (no AI), runs them against the app booted by the
sandbox, and emits one `api` event with per-operation results.

`accountId` is a 32-character Cloudflare account ID. It is only used by
Workers AI, and only together with `x-ai-key`; otherwise the deployment's AI
binding is used.

Headers add the keys:

```bash
curl -N http://127.0.0.1:8787/api/run \
  -H 'content-type: application/json' \
  -H 'x-github-token: ghp_…' \
  -H 'x-ai-key: sk-…' \
  -d '{"repo":"acme/api","ref":"main","provider":"openai","model":"gpt-6-astra"}'
```

Validation happens before the stream opens. A bad repo, model, missing key or
private base URL returns a normal JSON 4xx. A custom provider without a base
URL is rejected; known providers ignore any supplied URL.

Pipeline knobs are clamped server-side: retries `0–5`, coverage `0–100`, and
booleans default to `true` unless explicitly `false`.

### SSE framing

Each frame carries an event name and a JSON `data` payload that repeats the
type:

```text
event: log
data: {"type":"log","level":"info","text":"EdgeSpec run started for acme/api@main."}

event: step
data: {"type":"step","step":"scan","status":"start"}

event: done
data: {}
```

### Events

| Event        | Payload                                       | Notes                                                                                                  |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `log`        | `{level, text}`                               | `level` is `info`, `ai`, `warn`, `success` or `error`                                                  |
| `step`       | `{step, status, note?}`                       | `step`: `scan`, `generate`, `validate`, `correct`, `pull-request`. `status`: `start`, `done`, `failed` |
| `gaps`       | `{gaps}`                                      | Full gap list for this run (up to 50)                                                                  |
| `quota`      | `{rateLimit}`                                 | What the provider says about the calls it has left                                                     |
| `generation` | `{generation}`                                | Full `Generation`; repeated after a correction                                                         |
| `validation` | `{validation}`                                | `{ok, verified, output, durationMs}`                                                                   |
| `result`     | `{ok, pullRequestUrl?, reason?, generation?}` | Terminal outcome                                                                                       |
| `error`      | `{message}`                                   | Recoverable mid-stream failure; a `result` follows                                                     |
| `done`       | `{}`                                          | Always the last frame                                                                                  |

`Generation`:

```json
{
  "sourcePath": "src/math.ts",
  "testPath": "src/math.test.ts",
  "code": "import { describe, it, expect } from \"bun:test\";\n…",
  "provider": "openai",
  "model": "gpt-6-astra",
  "corrected": false
}
```

Flow details:

- No missing tests → `result {ok:true, reason:"No missing tests found."}`.
- Validation fails after all retries → `step pull-request failed`, then
  `result {ok:false, reason:<validation output>}`.
- A passing test → `step pull-request done` with the note `Ready to open`, then
  `result {ok:true, generation, ready:[…]}`. A run never creates a branch: the
  pull request is opened by hand through `POST /api/pull-request`.
- A run covers the first `maxFiles` gaps, highest risk first. Every file it
  covers streams its own `generation` and `validation` events, and `ready`
  lists the source paths whose tests passed.
- `maxTokens` caps the provider-reported tokens for the run (`0` = no cap).
  Reaching it ends the run with `result.ok: false`, the reason, and any
  tests that already passed. With no cap, the run still logs an estimated
  input-token range before spending.
- `flakyRuns` repeats a passing suite (default 2). A pass/fail split returns
  `validation {ok:false, verified:false, flaky:true, runs}`; it is quarantined,
  never counted as verified.
- `mutationCommand` runs only after a stable pass and only when set. The result
  is `validation.mutation` with either `{status:"measured", killed, survived,
total, score, command, budgetStopped?}` or `{status:"not-measured", reason}`.
  No report means not measured; a timeout is a labelled budget stop.
- `authFixture` carries optional `headers`/`query` values for contract tests.
  They are injected as `EDGESPEC_AUTH_HEADERS`/`EDGESPEC_AUTH_QUERY` into the
  sandbox environment only — never into generated code, events, run history or
  the PR. Without a fixture, a secured operation is skipped with that reason.
  Contract tests also exercise a missing required body field, a wrong scalar
  type, and an unauthenticated request; the generated file contains only
  placeholder env reads.
- Every AI generation carries `promptVersion`; the PR body prints it so a
  result is attributable to a prompt.
- The test runner is detected per repository (Playwright, Vitest, Jest, then
  Bun). Generated imports and validation commands use that runner; there is no
  runner override in the request.
- `autoRouteModels` is opt-in cheap-first routing; small first attempts use the
  cheapest tier, retries and large files use the strongest. Each generation
  event names the model actually used.
- `propertyTests` is opt-in and only applied when the repository depends on
  `fast-check`. Properties must be `[property]`-labelled with `numRuns: 50` and
  `seed: 42`; static validation fails otherwise, and fast-check surfaces the
  seed/counterexample on a failure.
- `fixtures` (a recorded fixture file) makes the contract suite start a tiny
  in-test mock server from `EDGESPEC_FIXTURES`; no live app is needed. If a
  deliberate spec change makes a recorded status invalid, the replay fails.
  Record with `POST /api/record`.
- Quota and 5xx responses fall back once to the next model of the same
  provider; the fallback appears as a `warn` log.
- A retest sends `retestOperations: [{specPath, method, path}]`. The run is
  forced to API mode, builds a contract file holding only those operations, and
  labels its `api` and `result` events with `retest: true`.
- Failed contract results carry `diagnosis` (`assertion`, `timeout`, `boot`,
  `missing-fixture`, `network`, `unknown`) plus `expected`/`actual` when the
  runner printed them.
- If an error occurs after streaming starts, the HTTP status is already 200;
  clients must inspect the events, not just the status.

---

## `POST /api/generate`

Generates one test for one file, optionally validates it, and returns JSON. Use
this for the "generate another gap" action. It does **not** run the correction
loop or open a PR.

Request:

```json
{
  "repo": "acme/api",
  "ref": "main",
  "path": "src/math.ts",
  "provider": "workers-ai",
  "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "strictTypes": true,
  "coverageTarget": 90
}
```

Response:

```json
{
  "generation": {
    "sourcePath": "src/math.ts",
    "testPath": "src/math.test.ts",
    "code": "…",
    "provider": "workers-ai",
    "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "corrected": false
  },
  "validation": {
    "ok": true,
    "verified": false,
    "output": "Static checks passed. No sandbox runner is configured, so the suite was not executed.",
    "durationMs": 2
  },
  "rateLimit": { "provider": "openai", "limit": 10000, "remaining": 8431 }
}
```

The test path is derived by replacing the source extension with
`.test.<extension>`.

`rateLimit` is present when the provider states how many calls are left; the
dashboard shows it on the provider badge. A provider that says nothing is not
guessed.

---

## `POST /api/pull-request`

Commits generated tests to a new branch and opens a PR. One test or a batch:
a batch is one branch, one commit and one pull request.

Request:

```json
{
  "repo": "acme/api",
  "files": [
    {
      "sourcePath": "src/math.ts",
      "path": "src/math.test.ts",
      "code": "import { describe, it, expect } from \"bun:test\";\n…",
      "provider": "openai",
      "model": "gpt-6-astra",
      "verified": true,
      "corrected": false,
      "checks": [
        { "name": "bun test", "kind": "test", "command": "bun test", "ok": true, "durationMs": 840 }
      ],
      "coverage": {
        "status": "measured",
        "path": "src/math.ts",
        "lines": { "before": 1, "after": 4, "delta": 3, "total": 10 }
      }
    }
  ],
  "skipped": [{ "method": "GET", "path": "/users", "reason": "missing auth fixture" }],
  "policy": {
    "draftOnly": true,
    "maxFiles": 10,
    "allowedPaths": ["tests/**", "src/**/*.test.ts"],
    "minCoverageDelta": 1,
    "labels": ["tests"],
    "reviewers": ["octocat"]
  },
  "strictTypes": true
}
```

A single test may also be sent as `sourcePath`, `testPath` and `code`.

Response:

```json
{ "url": "https://github.com/acme/api/pull/42", "files": 1 }
```

Behaviour:

- Runs the static checks first (400 with the problems if they fail). This is a
  plausibility gate, not a substitute for validation; the dashboard only enables
  the button after a passing validation.
- Branch name: `edgespec/test-<file>-<timestamp>` for one test,
  `edgespec/tests-<timestamp>` for a batch, created from the repo's default
  branch head.
- Every test of a batch is committed to the same branch, so the review covers
  all of them at once.
- The default PR body is built from the provenance the request carries: model,
  executed vs static verification, checks with durations, measured coverage,
  self-corrections, skipped contract operations, and the test-only guarantee.
  Send `body` to replace it with your own copy.
- Check output is never stored or echoed; only the check name, command,
  duration and outcome are used.
- `policy` gates run before any branch or commit exists. A violation returns
  `403` with `Policy blocked this pull request: <gate> — <reason>`. Gates are
  kill switch, draft-only, max files, allowed test-path globs, and a measured
  minimum coverage delta (unmeasured never satisfies it). Labels and reviewers
  are applied after opening and never fail the pull request.
- Requires a GitHub token with permission to push and open PRs.

---

## `GET | PATCH /api/backlog?repo=owner/name`

Durable test-debt items (D1). A full scan upserts every gap and closes items
that disappeared; a returning closed item reopens. Explicit `accepted`,
`rejected` and `ignored` states survive later scans. `owner` comes from
`CODEOWNERS` when one exists.

`GET` returns `{enabled, items}` with `path`, `kind`, `state`, `owner`, `risk`,
`reason`, `firstSeen`, `lastSeen`, `closedAt` and `lastRunId`.

`PATCH` changes one item:

```json
{ "path": "src/auth/token.ts", "state": "accepted", "owner": "@security" }
```

Valid states are `open`, `accepted`, `rejected`, `ignored`, and `closed`. Without
`RUNS_DB` the list is empty and writes return 501.

---

## `GET | PUT | DELETE /api/memory?repo=owner/name`

Opt-in repository memory (D1): approved conventions, helper paths, fixture
paths and the test naming convention. It is short strings only — never source.

```json
{
  "naming": "sibling .test.ts",
  "conventions": ["use the repository test helper"],
  "helpers": ["src/test-utils.ts"],
  "fixtures": ["tests/fixtures/users.json"]
}
```

`GET` returns `{enabled, memory}`; `PUT` sanitizes and stores; `DELETE` removes
it. Without `RUNS_DB` the list is empty and writes return 501. The memory is
loaded into `/api/run`, `/api/generate`, and the webhook workflow prompt.

---

## `GET | PUT | DELETE /api/schedules?repo=owner/name`

Opt-in scheduled drift scans (D1). The cron runs daily; each repository decides
whether it is due from `intervalDays` (1–30, default 7).

```json
{
  "repo": "acme/api",
  "intervalDays": 7,
  "enabled": true,
  "installationId": 42,
  "driftWebhookUrl": "https://hooks.slack.com/services/...",
  "driftWebhookSecretSet": true
}
```

`GET` returns `{enabled, schedules}`; `PUT` upserts the schedule
(`installationId` optional, used to mint an App token); `DELETE` removes it.
Without `RUNS_DB` the list is empty and writes return 501.

`PUT` accepts `driftWebhookUrl?` and `driftWebhookSecret?` for a
repository-specific override. The secret is write-only: responses report
`driftWebhookSecretSet` instead of the value. Sending an empty
`driftWebhookUrl` clears both the override and its secret.

A due scan keeps a snapshot of untested paths and OpenAPI `METHOD /path` names.
The first run is a baseline. Later runs compare against it; when anything
changed, one summary is POSTed to the effective webhook (Slack-compatible
`text`) with an optional `x-edgespec-secret` header, and written to R2 when the
`ARTIFACTS` binding exists.

Resolution order:

1. repository schedule override;
2. workspace drift webhook;
3. deployment `DRIFT_WEBHOOK_URL` fallback.

A quiet repository sends nothing and opens nothing. The scan never opens a pull
request: the summary is the action. The audit event records `notified` and
`webhookSource` (`repository`, `workspace`, `environment`, or `none`).

---

## `GET | PUT | DELETE /api/policies?repo=owner/name`

Opt-in server-side policy for CI (the same D1 database as run history). The
dashboard keeps its own copy in `localStorage` and sends it per request, so this
endpoint is for webhook runs.

```json
{
  "draftOnly": true,
  "maxFiles": 10,
  "allowedPaths": ["tests/**"],
  "minCoverageDelta": 1,
  "labels": ["tests"],
  "reviewers": ["octocat"]
}
```

`GET` returns `{enabled, policy}`; `PUT` stores the sanitized policy; `DELETE`
removes it. Without a `RUNS_DB` binding the routes answer `enabled: false` or 501. The webhook workflow reads this policy before creating a pull request and
returns `status: "blocked"` with the gate reason when it fails.

---

## `GET | PUT /api/workspace`

One workspace per deployment; there is no multi-user account model. `GET`
returns `{enabled, workspace}`; without `RUNS_DB` it answers `enabled: false`.
The record is created lazily on first read.

```json
{
  "enabled": true,
  "workspace": {
    "id": "default",
    "name": "Default workspace",
    "retentionDays": 30,
    "driftWebhookUrl": "https://hooks.slack.com/services/...",
    "driftWebhookSecretSet": true,
    "createdAt": 1760000000000,
    "updatedAt": 1760000000000
  }
}
```

`PUT` accepts `{name?, retentionDays?, driftWebhookUrl?, driftWebhookSecret?}`.
The name is trimmed to 100 characters; retention is clamped to 1–365 days.

The drift webhook secret is write-only: it is accepted on `PUT`, never returned,
and reported only as `driftWebhookSecretSet`. Sending an empty
`driftWebhookUrl` clears the URL and secret. Sending an empty
`driftWebhookSecret` clears only the secret. Changing the URL without sending a
new secret clears the old secret rather than forwarding it to the new endpoint.
Omitted fields keep their current values. Updating the workspace writes an
audit event.

Per-repository schedules can override the workspace webhook through
`PUT /api/schedules`. Resolution order is repository → workspace → deployment
`DRIFT_WEBHOOK_URL`.

---

## `GET /api/audit?repo=owner/name&limit=100`

Recent audit events, newest first. `repo` is optional and filters by
`owner/name`; `limit` defaults to 100 and is clamped to 200. Without `RUNS_DB`
the route answers `{enabled: false, events: []}`.

```json
{
  "enabled": true,
  "events": [
    {
      "id": 12,
      "repo": "acme/api",
      "actor": "github-app",
      "action": "pr_opened",
      "detail": { "url": "https://github.com/acme/api/pull/42", "files": 1 },
      "createdAt": 1760000000000
    }
  ]
}
```

Actions include `pr_opened`, `pr_blocked`, `pr_check`, `command`,
`policy_updated`, `memory_updated`, `schedule_updated`, `schedule_deleted`,
`backlog_updated`, `workspace_updated`, `drift_scan` and `retention_purge`.
Detail is structural only: keys matching token/key/secret/password/
authorization/cookie are dropped recursively, so a key or token is never
stored. Actors are `dashboard`, `github-app`, `cron`, or a GitHub login for PR
commands.

---

## `GET /api/pulls?repo=owner/name`

Lists the 20 most recent pull requests in all states.

```json
{
  "pulls": [
    {
      "number": 42,
      "title": "test: add unit tests for src/math.ts",
      "url": "https://github.com/acme/api/pull/42",
      "state": "open",
      "author": "edge-spec-bot",
      "branch": "edgespec/test-math-1760000000000",
      "createdAt": "2026-10-21T04:00:00Z"
    }
  ]
}
```

A token is optional for public repositories; private repositories return 404
without one.

---

## `POST /webhook`

GitHub webhook receiver for automation. Subscribe to **push** and
**pull_request** events.

Behaviour:

1. If `GH_WEBHOOK_SECRET` is set, verifies `x-hub-signature-256` against the
   raw body. Invalid → 401.
2. Reads `repository.full_name` and `installation.id`.
3. `push` starts `TestGenerationWorkflow` with `{repo, ref, event:"push",
installationId?}` and returns `202 {"workflowId":"…"}`.
4. `pull_request` (only `opened`, `synchronize`, `reopened`) starts the same
   workflow in check mode with `{repo, ref:<head sha>, pullRequest, headSha,
event:"pull_request"}`. Other actions return `202 {"ignored":"…"}` without
   starting work.
5. The workflow mints a repo-scoped installation token when
   `GH_APP_ID`/`GH_APP_PRIVATE_KEY` are configured, cached until just
   before expiry; otherwise it uses `GH_TOKEN`.

Check mode is advisory: it scans the changed files, reports changed sources
without tests, runs their existing tests when a runner is configured, and
upserts one check run plus one marked comment. Re-runs update those instead of
adding more. It never commits, generates a test, or opens a PR. It runs the
changed files plus their direct and transitive test dependents from a bounded
import graph (test files and their relative imports, up to 200 files); the
summary says when the graph is partial. Without a runner the check is `neutral`
and its annotations say static only.

`issue_comment` events support three commands in a pull request comment:
`/edgespec retest`, `/edgespec coverage`, and `/edgespec explain <file|METHOD
/path>`. Only `OWNER`, `MEMBER` and `COLLABORATOR` comments are accepted; bots
and outsiders are ignored. One command per user, pull request and command is
accepted per 60-second window (D1 when configured, per-isolate otherwise). Each
accepted command posts exactly one reply and upserts the same EdgeSpec check.
`retest` re-runs the changed files' existing tests, `coverage` reports measured
LCOV line rates from one run (never a delta), and `explain` answers from the
tree, scanner and OpenAPI spec without spending AI. Missing arguments or
unrelated comments are ignored with 202.

The workflow uses the deployment's Workers AI binding and never receives
visitor keys. Missing bindings return 501; no credential returns a failed run
with a readable error.

---

## Run history

History is optional and lives in D1 (`RUNS_DB`). Without the binding every
route below answers `{ "enabled": false }` and nothing is stored. Summaries are
kept in D1; raw checks and coverage facts are kept in R2 (`ARTIFACTS`); generated
test source is never stored in either.

### `GET /api/runs?repo=owner/name&limit=20`

Lists recent runs for one repository, newest first.

```json
{
  "enabled": true,
  "runs": [
    {
      "id": "01234567-89ab-cdef-0123-456789abcdef",
      "repo": "acme/api",
      "ref": "main",
      "status": "ready",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "startedAt": 1793000000000,
      "finishedAt": 1793000012000,
      "totals": { "missing": 4, "coverage": 0, "api": 0, "unsupported": 0, "skipped": 0 }
    }
  ]
}
```

### `DELETE /api/runs?repo=owner/name`

Deletes that repository's runs, their files, and their stored R2 bundles.
Returns `{ "deleted": 3 }`. `501` means the deployment has no D1 binding.

### `GET /api/runs/:id/files`

Returns one run and its per-file rows (`sourcePath`, `testPath`, `decision`,
`verified`, `checks`, optional `coverage`). `404` when the id is unknown.
History ids must be 8–64 URL-safe characters.

### `POST /api/runs/:id/decisions`

Records review decisions for files in a run.

```json
{ "decisions": [{ "sourcePath": "src/a.ts", "decision": "accepted" }] }
```

`decision` is `accepted`, `rejected` or `pending`; up to 200 entries are
applied. Unknown paths are ignored. Returns `{ "updated": 1 }`.

---

## `GET /api/runs/:id`

Returns the Cloudflare Workflow instance status (passthrough), for polling a
webhook-triggered run.

```json
{ "status": "running" }
```

The exact fields are those of the Cloudflare Workflows `Instance.status()` API.

---

## `GET /api/runs/:id/artifacts`

Returns the stored bundle for an interactive `/api/run`: per-file validation
checks, coverage facts and totals. The bundle lives in R2 (`ARTIFACTS`), so it
outlives the SSE stream; generated test source is not stored.

```json
{
  "enabled": true,
  "artifact": {
    "runId": "…",
    "repo": "acme/api",
    "ref": "main",
    "status": "ready",
    "finishedAt": 1793000000000,
    "files": [{ "sourcePath": "src/a.ts", "verified": true, "checks": [] }]
  }
}
```

`404` means the run stored no bundle; `{ "enabled": false }` means the
deployment has no `ARTIFACTS` binding. Deleting a repository's history also
deletes its bundles.

---

## Local development routes

`GET /local-api/scan` and `GET /local-api/file` exist for the Vite dev server.
The Worker itself answers `403` for any non-localhost `Host` and `400` on
localhost; the real filesystem read happens in the Vite middleware, so a
deployed Worker never touches a visitor's disk.

---

## Limits and timeouts

| Item                    | Value              |
| ----------------------- | ------------------ |
| Scan gaps returned      | 25                 |
| Gaps enriched per scan  | 8                  |
| Pipeline target         | first gap          |
| Gap list in a run event | 50                 |
| Retries                 | 0–5 (default 2)    |
| Coverage target         | 0–100 (default 90) |
| AI request timeout      | 120 s              |
| Sandbox timeout         | 120 s              |
| Output tokens           | 4096               |
| Validation output kept  | 6000 characters    |
| Pull list               | 20                 |
