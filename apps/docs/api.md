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

`sandbox` is `true` when `SANDBOX_RUNNER_URL` is configured. The dashboard uses
it to avoid promising an executed test.

---

## `POST /api/sandbox/health`

Probes a sandbox runner's `GET /health`. The Worker makes the request, so the
browser never has to reach an arbitrary origin and the key is not exposed to it.

```json
{ "url": "https://sandbox.example.com", "config": { "timeoutMs": 180000 } }
```

`url` may be omitted when `x-sandbox-url` or `SANDBOX_RUNNER_URL` supplies one.
The key comes from `x-sandbox-key` or `SANDBOX_API_KEY`. On a deployed Worker,
loopback and private targets are refused; a local Worker may use
`http://localhost`.

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

## `POST /api/coverage`

Runs the repository's own test command in a sandbox runner with coverage, and
classifies files whose tests exist but whose lines or branches fall short of
`coverageTarget`.

Request:

```json
{ "repo": "acme/api", "ref": "main", "coverageTarget": 90 }
```

Needs `x-sandbox-url` (or `SANDBOX_RUNNER_URL`); without a runner the route
returns `400`. Non-secret knobs travel in `x-sandbox-config`, exactly as a run
does. The test command comes from `package.json`/CI detection; EdgeSpec never
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
      "code": "import { describe, it, expect } from \"bun:test\";\n…"
    }
  ],
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
- Commit message and PR body identify EdgeSpec and the source files.
- Requires a GitHub token with permission to push and open PRs.

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

GitHub webhook receiver for automation. Configure it for **push** events (the
handler does not branch on event type, so subscribe only to the events you want
runs for).

Behaviour:

1. If `GITHUB_WEBHOOK_SECRET` is set, verifies `x-hub-signature-256` against the
   raw body. Invalid → 401.
2. Reads `repository.full_name` and `ref` (`refs/heads/x` → `x`; defaults to
   `main`).
3. Starts `TestGenerationWorkflow` with `{repo, ref}` and returns
   `202 {"workflowId":"…"}`.

The workflow uses the deployment's Workers AI binding and `GITHUB_TOKEN`; it
never receives visitor keys. Missing bindings return 501.

---

## `GET /api/runs/:id`

Returns the Cloudflare Workflow instance status (passthrough), for polling a
webhook-triggered run.

```json
{ "status": "running" }
```

The exact fields are those of the Cloudflare Workflows `Instance.status()` API.

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
