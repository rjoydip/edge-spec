# Architecture

## Topology

```text
Browser / CLI / MCP client
  │  React dashboard (localStorage: settings + keys)
  │  edge-spec CLI or local stdio MCP server (keys from env)
  │  fetch + SSE, credentials as headers
  ▼
Cloudflare Worker (Hono)
  ├─ /api/*            JSON + SSE
  ├─ /webhook          GitHub webhook receiver
  ├─ ASSETS binding    built React app (assets-first routing)
  ├─ AI binding        Workers AI
  └─ TEST_GENERATION_WORKFLOW
          │
          ▼
     TestGenerationWorkflow  (durable, deployment-owned credentials)

Outbound from the Worker:
  api.github.com                  tree, files, branches, commits, PRs
  provider endpoint               OpenAI-compatible / Anthropic / Gemini
  SANDBOX_RUNNER_URL (optional)   executes `bun test`
```

The Worker is stateless. There is no KV, D1 or R2 binding, and no session. A
request carries everything needed to serve it.

## Frontend bundle

The dashboard is a Vite SPA served from `dist/web` by the `ASSETS` binding.
The build splits it so a deploy does not invalidate the heavy parts:

| Chunk    | What                 | When it loads                  |
| -------- | -------------------- | ------------------------------ |
| `index`  | the dashboard code   | always                         |
| `react`  | react and react-dom  | always                         |
| `radix`  | the Radix primitives | always                         |
| `vendor` | the rest             | always                         |
| `icons`  | lucide               | always                         |
| `trees`  | `@pierre/trees`      | when a file view opens         |
| `kirari` | the code highlighter | when a generated test is shown |

The two heavy ones are behind `React.lazy` (`apps/web/src/components/path-tree.tsx`
and `apps/web/src/components/code-view.tsx`), so the file tree and the syntax
highlighter are only parsed and executed when a reader actually needs them.
`apps/web/vite.config.ts` names the vendor chunks with `manualChunks`, so a change in
the app code does not invalidate the cached vendor files.

## Modules

| Module                          | Responsibility                                                                 | Rules                                                    |
| ------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `packages/core/src/types.ts`    | `Gap`, `Generation`, `Validation`, `RunEvent`, `HttpError`                     | No HTTP or provider knowledge                            |
| `packages/core/src/catalog.ts`  | Provider/model catalog, `resolveAi`, `parseRepo`, `parseRef`, `pipelineConfig` | Single source of truth for validation and defaults       |
| `packages/core/src/github.ts`   | REST client: tree, file, branch, commit, PR, PR list                           | `fetch`, no SDK; path segments encoded                   |
| `packages/core/src/scanner.ts`  | Gap detection, export extraction, risk heuristic, repository overview          | Regex-based, no TypeScript parser                        |
| `packages/core/src/ci.ts`       | Reads the repository's checks, formatter and style rules                       | Pure functions over the tree, the manifest and workflows |
| `packages/core/src/ai.ts`       | Prompt, code extraction, provider dispatch                                     | Key only goes into upstream request headers              |
| `packages/core/src/validate.ts` | Static checks + optional sandbox execution                                     | `verified` is true only after a runner ran               |
| `packages/core/src/pipeline.ts` | Async generator for scan → generate → validate → correct → PR                  | Transport-agnostic                                       |
| `apps/worker/src/index.ts`      | Hono routes, header parsing, SSE framing                                       | Translates HTTP to core calls                            |
| `apps/worker/src/workflow.ts`   | Durable webhook automation                                                     | Deployment credentials only                              |
| `apps/web/src/`                 | Dashboard                                                                      | `App.tsx` owns run state; components are presentational  |
| `packages/ui/src/`              | React primitives and brand tokens                                              | Dashboard imports components; docs imports `theme.css`   |
| `packages/client/src/`          | Worker API client, SSE parsing, env defaults                                   | No pipeline logic; CLI and MCP use it                    |
| `apps/cli/src/`                 | `scan`, `generate`, `run`, `catalog` commands                                  | Secrets from env, never flags                            |
| `apps/mcp/src/`                 | Stdio MCP tools over the shared client                                         | PR tool requires `confirm: true`                         |

## Interactive run (`POST /api/run`)

```text
POST /api/run
  parse repo + ref                     400 on invalid input
  resolve AI choice                    400 if provider/key/model/base URL unusable
  open SSE stream                      200 text/event-stream
  runPipeline(...)
    step scan       GitHub tree → findGaps
    gaps event      list with risk and exports
    step generate   fetch source → prompt chosen model → extract code
    generation      full test file
    step validate   static checks, then sandbox if configured
    validation      {ok, verified, output, durationMs}
    loop            up to maxRetries corrections while !ok
    step PR         ready to open                    (the reviewer opens it)
    result          {ok, pullRequestUrl?, reason?, generation?}
  done frame
```

Validation order matters:

1. **Static checks** always run. Failure stops the run before any sandbox call.
2. **Sandbox** runs only if `SANDBOX_RUNNER_URL` is set. The result is
   `verified: true`.
3. **No sandbox** returns `ok: true` only when static checks pass, with
   `verified: false` and an explicit message. The UI labels this _static check
   only_.

A failed validation is fed back to the model with the previous code and runner
output. The loop is bounded by `maxRetries` (clamped to 0–5). If it still fails,
no PR is opened and the result is `ok: false`.

Only the **first gap** is attempted per run. Scanning is cheap; generating is
not. The dashboard lets the user generate another gap individually via
`POST /api/generate`.

## Webhook automation (`TestGenerationWorkflow`)

```text
GitHub ── POST /webhook ──▶ verify HMAC (if GITHUB_WEBHOOK_SECRET is set)
                            parse repository.full_name + ref
                            binding.create({ repo, ref })  → 202 { workflowId }
Workflow
  scan-repository     tree, first gap, source          (durable step)
  generate-test       Workers AI                       (2 retries, exponential)
  validate-test       static + optional sandbox
  correct-test-N      bounded by maxRetries
  create-pull-request branch + file + PR
```

Workflow parameters are persisted by Cloudflare. Therefore the workflow:

- never accepts a visitor's provider key,
- uses the deployment's `AI` binding and `GITHUB_TOKEN`,
- rejects non-Workers-AI providers with a clear error.

The dashboard remains the place for bring-your-own-key runs.

## GitHub client

`GitHub` wraps the operations used by the pipeline:

- `tree(repo, ref)` — recursive tree, blobs only for scanning.
- `file(repo, path, ref)` — decodes Base64 content.
- `branches(repo)`, `defaultBranch(repo)` — feed the header branch dropdown.
- `headSha`, `createBranch`, `putFile`, `openPull` — one branch and one commit.
- `pulls(repo)` — 20 newest, all states.

Authentication is optional per request: a token enables private repositories,
avoids anonymous rate limits, and is required to push or open PRs. Public reads
work without one.

> Workers detail: `fetch` is captured as a local before invocation. Calling it as
> `this.fetchImpl(...)` throws `Illegal invocation` in the Workers runtime.

## Scanning rules

A path is a source file when it matches `.ts .tsx .js .jsx .mjs .cjs` and is not:

- a test (`*.test.*`, `*.spec.*`),
- a declaration (`*.d.ts`, `*.d.mts`, `*.d.cts`),
- under generated/vendor directories (`dist`, `build`, `out`, `coverage`,
  `node_modules`, `vendor`, `generated`, `__generated__`, `migrations`),
- under a test directory (`test`, `tests`, `__tests__`, `__mocks__`, `e2e`,
  `fixtures`),
- a tool config (`vite`, `vitest`, `jest`, `playwright`, `tailwind`, `postcss`,
  `eslint`, `wrangler`, `bun`, `tsconfig`, `setup`, `webpack`, `rollup`).

A gap is a source file whose sibling `<name>.test.<ext>` (or `.spec`) is absent.
Exports are extracted with regexes (best effort, capped at 12). Risk is a path
heuristic: auth/token/payment/webhook keywords → high; util/helper/theme/UI
keywords → low; otherwise medium, or high above 20 exports.

## Security boundaries

| Boundary            | Control                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Repository input    | `parseRepoInput` accepts a folder start path in the header; the API gets `owner/name` only, via `parseRepo`, with no traversal |
| Branch selector     | Values come from GitHub's branch list; `parseRef` still rejects `..`, leading `/`, unsafe characters                           |
| Provider selection  | Catalog allowlist; unknown providers and models are rejected                                                                   |
| Base URL            | Only the custom provider (`private` id) accepts one; known providers cannot be redirected, preventing key exfiltration         |
| Workflow params     | Never contain user keys                                                                                                        |
| CLI/MCP credentials | Environment only; no key flags or tool arguments                                                                               |
| Webhook             | HMAC SHA-256 verification when a secret is configured                                                                          |
| Code execution      | Generated code is never executed on the Worker; only an external sandbox may run it                                            |
| Generated content   | Always treated as a draft; PR body says so                                                                                     |

Keys are held in browser `localStorage` only; the Worker forwards them and
does not log or persist them. This is still a bearer-token model: a compromised
browser or deployment can read them. See [Configuration](configuration.md).

## Failure behaviour

- Validation errors before streaming → JSON `{error, status}` with 4xx/5xx.
- Errors after streaming starts → an `error` event, then `result` (`ok: false`),
  then `done`; the HTTP status stays 200 because headers are already sent.
- Provider 401/403 → 400 with a short message (so the UI can say "check your
  key"); other provider failures → 502.
- Sandbox unreachable → validation `ok: false`, `verified: false`.
- GitHub failures include a readable message; 404 usually means private repo or
  a bad ref.

## Why these choices

- **No SDKs** for GitHub or AI: the surface used here is small, and `fetch`
  keeps the Worker bundle lean.
- **No server state**: removes storage, GDPR and cache-invalidation questions
  for a tool that runs on demand.
- **Async generator pipeline**: the interactive path is one implementation over
  SSE. The durable Workflow calls the same core scan/generate/validate functions
  inside its steps, so behaviour stays close without persisting user keys.
- **CLI and MCP are API clients**: they reuse the Worker's scan/generate/run/PR
  routes instead of duplicating the pipeline, so the dashboard, terminal, and
  agents all see the same validation and sandbox behavior.
- **Radix primitives (shadcn-style)**: accessible dialog, select, tabs, switch
  and slider without hand-rolling focus management or keyboard behaviour.
