# AGENTS.md

Repository conventions for EdgeSpec. Read this before changing code.

## What this is

A single Cloudflare Worker that serves a React dashboard and a test-generation
API. It scans a user-supplied GitHub repository, generates a `bun:test` file
with a user-chosen AI provider, validates it, and opens a PR. The CLI and MCP
server are separate API clients in the same workspace.

Stack: TypeScript, Hono, React 19, Tailwind v4, Vite, Alchemy, Bun.

## Commands

```bash
bun install
bun run dev:worker     # API on http://127.0.0.1:8787
bun run dev            # dashboard on http://127.0.0.1:5173 (proxies /api)
bun run dev:all        # both
bun --silent run cli -- --help  # terminal client
bun run mcp -- --help  # stdio MCP server
bun run sandbox        # self-hosted test runner on http://127.0.0.1:8788
bun run docs:dev       # documentation site on http://127.0.0.1:5174
bun run docs:build     # static site in apps/docs/.vitepress/dist
bun run docs:deploy    # build + upload the site to Cloudflare Pages
bun run test:stack     # opt-in live stack test for every target (test:cloudflare|aws|vercel|fly|railway|docker|kubernetes individually)
bun test               # discovers every workspace's test/ directory
bun run typecheck      # bun check in every workspace
bun run build
bun run verify         # format:check + lint + check + test
bun run deploy         # build + bun run --cwd infra/cloudflare deploy --stage prod
bun run deploy:aws     # bun run --cwd infra/aws deploy --stage prod
bun run deploy:vercel  # bun run --cwd infra/vercel deploy --stage prod
bun run deploy:fly     # bun run --cwd infra/fly deploy --stage prod
bun run deploy:railway # bun run --cwd infra/railway deploy --stage prod
bun run deploy:docker  # bun run --cwd infra/docker deploy --stage prod
bun run deploy:kubernetes # bun run --cwd infra/kubernetes deploy --stage prod
bun run --cwd infra/cloudflare deploy --stage prod --dry-run
```

Formatting is Bun-native (`bun fmt`), with the width and object-wrap flags in
the root scripts; typechecking is Bun-native (`bun check`).
Oxlint stays because Bun has no built-in linter. Do not reintroduce oxfmt.

After every code change, run `bun fmt` (or `bun run format`) and `bun run check`
before claiming it works. `bun run verify` runs the whole gate (format check,
lint, `bun check .` across every project, tests). For a UI change, also run
`bun run build` (Tailwind class typos only fail at build time).

## Layout

- `packages/core/src/` — pure logic. No Hono, no React, no browser globals.
  `scanner.ts` owns classification (`classifyTree`: missing/unsupported plus the
  existing tests per source), `coverage.ts` parses LCOV, `openapi.ts` builds
  deterministic contract tests and parses JUnit, `api-surface.ts` infers an
  OpenAPI document from route calls when one is missing, and `pipeline.ts` runs
  files through a bounded pool whose events name their `sourcePath`.
- `packages/client/src/` — HTTP client for the Worker API, shared by the CLI and
  MCP server. It may import core types but must not call core pipeline code.
- `packages/ui/src/` — shared React primitives and `theme.css` brand tokens. The
  dashboard imports the components; the VitePress site imports only the tokens.
- `packages/cli/src/` — `scan`, `generate`, `run`, `watch`, and `catalog` commands.
- `packages/mcp/src/` — stdio MCP server wrapping the shared client.
- `packages/sandbox/src/` — reference self-hosted runner; `bwrap`/Docker/Podman plus
  hosted E2B/Vercel/Daytona SDK drivers, no image build.
- `examples/` — scenario apps for local test generation: framework examples
  (`missing-openapi/`, `express/`, `elysia/`), `node/`, `openapi/`, and dependency-free
  fixtures in `src/`. Reference tests stay in each `tests/` folder;
  `complete-app/` deliberately has sibling tests.
- `apps/worker/src/` — Cloudflare-only entry: `index.ts` (bindings → ports,
  `fetch` + `scheduled`, Workflow export). The KV cache and Workflows
  adapters live in `packages/adapters/src/cloudflare/`, including the local
  `cloudflare.d.ts` declaration.
- `apps/web/src/` — dashboard. `App.tsx` owns run state; components are presentational.
- `apps/docs/` — VitePress documentation site (markdown in `apps/docs`, `.vitepress` = config/theme).
- `evals/` — golden-scan harness (`harness.ts`, `run.ts`, `golden.json`) and its
  test; `bun run eval` spends no AI. `scripts/dev.ts` is the combined dev stack.
- `config/` — shared `tsconfig.base.json`; every workspace tsconfig extends it.
- `infra/` — provider glue and IaC, one folder per target: `cloudflare/`
  (`cloudflare.run.ts` + live test), `aws/` (`aws.run.ts`), `vercel/`
  (`vercel.run.ts` + handler), `fly/`, `railway/`, `docker/`, `kubernetes/`,
  and `shared/stage.ts`. Each provider folder is its own Bun workspace with its
  own scripts and `.env.example`. There is no `wrangler.toml`;
  `bun run deploy[:aws|:vercel|:fly|:railway|:docker|:kubernetes]` goes through
  Alchemy.
- `assets/github-app/` — GitHub App listing copy and its `icon.svg`. Change the
  copy there, then paste it into the app's settings.
- `PLAN.md` — product requirements and review feedback.

Tests live in each workspace's `test/` directory. The exception is `examples/`:
reference tests live in `examples/tests/` and `examples/*/tests/` so
EdgeSpec still sees the incomplete examples as gaps. `examples/complete-app/`
deliberately keeps its test beside the source. Do not colocate `*.test.ts` under
`src/` elsewhere.

Bun workspaces live under `apps/*`, `packages/*`, `evals/`, `examples/`, and
`infra/*`. `packages/`
holds what you import or run yourself: `packages/core`
(`@edge-spec/core/<module>`), `packages/runtime` (`@edge-spec/runtime/<module>`, the
portable runtime), `packages/client` (`@edge-spec/client`),
`packages/ui` (`@edge-spec/ui`, plus `theme.css`), the `bin` entry points
`packages/cli` and `packages/mcp`, and the self-hosted `packages/sandbox`
runner. `apps/` is what this repository deploys: `@edge-spec/web`,
`@edge-spec/worker`, and the `@edge-spec/docs` site. Vite outputs the web and
worker bundles to the root `dist/`, which Alchemy uploads.

The CLI and MCP server are **API clients**. Do not make them call
`packages/core/src/pipeline.ts` directly; that would fork the behavior from the
dashboard and the deployment's Workers AI/sandbox.

## Invariants

1. **The deployment stores no user configuration.** Repository, provider, model,
   pipeline knobs live in `localStorage`; GitHub and AI keys are sent as headers
   (`x-github-token`, `x-ai-key`, `x-ai-base-url`) per request. Account rows
   (email, Better Auth's password hash, plan) are the deliberate exception:
   they live in SQL and the dashboard requires a session before it renders.
2. **Workflow params are persisted.** Never pass a user API key to
   `TestGenerationWorkflow`; it uses the deployment's Workers AI and a GitHub App
   installation token (or `GH_TOKEN` when no App is configured). The
   installation id is not a secret and may be persisted.
3. **Be honest about validation.** `Validation.verified` is true only when a
   runner executed the suite. No sandbox means "static check only", never
   "passed".
4. **No invented metrics.** Gap risk is a path heuristic; there is no coverage
   percentage without a runner.
5. **Repository is always caller-supplied.** Validate with `parseRepo`; no
   server-side default.
6. **No visible scrollbar.** The page scrolls. Keep the global `html` rule and
   `.no-scrollbar` on inner panes.
7. **Theme is tokens, not duplicate components.** Light mode remaps the zinc ramp
   in `tailwind.css`; the accent is `--accent-base`. Add new colours as tokens.
8. **Header stays aligned.** Controls are `h-9` or icon-sized, one
   `items-center` row. Do not put engine names ("Cloudflare Workflows v2") back
   into the chrome.
9. **CLI and MCP secrets are environment-only.** Never add key flags or tool
   arguments; keys travel in request headers, exactly like the dashboard.
10. **UI primitives live in `packages/ui`.** The dashboard imports the React
    components; the VitePress site consumes only `theme.css`. Do not copy
    primitives back into `apps/web`.
11. **Runtime capabilities go through ports.** SQL, objects, jobs, cache and
    email are `SqlDatabase` / `ObjectStore` / `JobQueue` / `CacheStore` /
    `EmailSender` and `Observer` from `packages/runtime/src/ports.ts`
    (re-exported by `env.ts`), resolved by `platform.ts`. Vendor drivers live in `packages/adapters`
    (`node/select.ts`, `cloudflare/`, `aws/lambda.ts`) and `packages/db`; the
    shared app must not import them. One Hono app (`packages/runtime/src/app.ts`)
    serves every entry — `apps/worker` (Cloudflare), `apps/server` (Bun), the
    Vercel function and the AWS Lambda handler — and each entry stays thin.
    `apps/worker` stays Cloudflare-only: never let `pg`/`aws4fetch` reach it.

## Adding a provider or model

Edit `packages/core/src/catalog.ts` only:

- Add a `Provider` with `protocol` (`workers-ai`, `openai`, `anthropic`,
  `google`) and `models`.
- `needsKey` controls whether Settings requires a key. `custom: true` is the
  private/OpenAI-compatible path and requires a base URL.
- Known providers' base URLs cannot be overridden by a request; that protects
  the user's key from being redirected.
- Add a test in `packages/core/test/catalog.test.ts` if the rule changes.

## Gotchas

- In Workers, call `fetch` as a standalone function. `this.fetchImpl(...)` throws
  `Illegal invocation`; `github.ts` captures it in a local first.
- `import ... from "cloudflare:workers"` must stay external in
  `apps/worker/vite.config.ts`; it is declared in
  `packages/adapters/src/cloudflare/cloudflare.d.ts`.
- GitHub ignores unauthenticated access to private repos and rate-limits
  anonymous tree reads.
- `design.sample.ts` is a reference mockup, not app code. It is excluded from
  lint, format and the build. Do not import from it.

## Tests

One runnable check per non-trivial rule, using `bun:test`. Prefer pure functions
with fake `fetch`/GitHub objects. The pipeline test asserts the repo and ref are
forwarded to every GitHub call — keep that guard when refactoring.
