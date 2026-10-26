# AGENTS.md

Repository conventions for EdgeSpec. Read this before changing code.

## What this is

A single Cloudflare Worker that serves a React dashboard and a test-generation
API. It scans a user-supplied GitHub repository, generates a `bun:test` file
with a user-chosen AI provider, validates it, and opens a PR. The CLI and MCP
server are separate API clients in the same workspace.

Stack: TypeScript, Hono, React 19, Tailwind v4, Vite, Wrangler, Bun.

## Commands

```bash
bun install
bun run dev:worker     # API on http://127.0.0.1:8787
bun run dev            # dashboard on http://127.0.0.1:5173 (proxies /api)
bun --silent run cli -- --help  # terminal client
bun run mcp -- --help  # stdio MCP server
bun run sandbox        # self-hosted test runner on http://127.0.0.1:8788
bun run docs:dev       # documentation site on http://127.0.0.1:5174
bun run docs:build     # static site in apps/docs/.vitepress/dist
bun test               # discovers every workspace's test/ directory
bun run typecheck      # bun check in every workspace
bun run build
bun run check          # format:check + lint + typecheck + test
bun run deploy -- --dry-run
```

Formatting is Bun-native (`bun fmt`); typechecking is Bun-native (`bun check`).
Oxlint stays because Bun has no built-in linter. Do not reintroduce oxfmt.

Run `bun run check` before claiming a change works. For a UI change, also run
`bun run build` (Tailwind class typos only fail at build time).

## Layout

- `packages/core/src/` — pure logic. No Hono, no React, no browser globals.
  `scanner.ts` owns classification (`classifyTree`: missing/unsupported plus the
  existing tests per source), `coverage.ts` parses LCOV, `openapi.ts` builds
  deterministic contract tests and parses JUnit, and `pipeline.ts` runs files
  through a bounded pool whose events name their `sourcePath`.
- `packages/client/src/` — HTTP client for the Worker API, shared by the CLI and
  MCP server. It may import core types but must not call core pipeline code.
- `packages/ui/src/` — shared React primitives and `theme.css` brand tokens. The
  dashboard imports the components; the VitePress site imports only the tokens.
- `packages/cli/src/` — `scan`, `generate`, `run`, and `catalog` commands.
- `packages/mcp/src/` — stdio MCP server wrapping the shared client.
- `packages/sandbox/src/` — reference self-hosted runner; `bwrap`/Docker/Podman plus
  hosted E2B/Vercel/Daytona SDK drivers, no image build.
- `examples/` — scenario apps for local test generation: framework examples
  (`hono/`, `express/`, `elysia/`), `pure-node/`, `openapi/`, and dependency-free
  fixtures in `src/`. Reference tests stay in each `tests/` folder;
  `complete-app/` deliberately has sibling tests.
- `apps/worker/src/` — HTTP adapters (`index.ts`), bindings (`env.ts`) and the
  durable `workflow.ts`.
- `apps/web/src/` — dashboard. `App.tsx` owns run state; components are presentational.
- `apps/docs/` — VitePress documentation site (markdown in `apps/docs`, `.vitepress` = config/theme).
- `PLAN.md` — product requirements and review feedback.

Tests live in each workspace's `test/` directory. The exception is `examples/`:
reference tests live in `examples/tests/` and `examples/*/tests/` so
EdgeSpec still sees the incomplete examples as gaps. `examples/complete-app/`
deliberately keeps its test beside the source. Do not colocate `*.test.ts` under
`src/` elsewhere.

Bun workspaces live under `apps/*`, `packages/*`, and `examples/`. `packages/`
holds what you import or run yourself: `packages/core`
(`@edge-spec/core/<module>`), `packages/client` (`@edge-spec/client`),
`packages/ui` (`@edge-spec/ui`, plus `theme.css`), the `bin` entry points
`packages/cli` and `packages/mcp`, and the self-hosted `packages/sandbox`
runner. `apps/` is what this repository deploys: `@edge-spec/web`,
`@edge-spec/worker`, and the `@edge-spec/docs` site. Vite outputs the web and
worker bundles to the root `dist/`, which is what `wrangler.toml` uploads.

The CLI and MCP server are **API clients**. Do not make them call
`packages/core/src/pipeline.ts` directly; that would fork the behavior from the
dashboard and the deployment's Workers AI/sandbox.

## Invariants

1. **The deployment stores no user configuration.** Repository, provider, model,
   pipeline knobs live in `localStorage`; GitHub and AI keys are sent as headers
   (`x-github-token`, `x-ai-key`, `x-ai-base-url`) per request.
2. **Workflow params are persisted.** Never pass a user API key to
   `TestGenerationWorkflow`; it uses the deployment's Workers AI and a GitHub App
   installation token (or `GITHUB_TOKEN` when no App is configured). The
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
  `apps/worker/vite.config.ts`; it is declared in `apps/worker/src/cloudflare.d.ts`.
- GitHub ignores unauthenticated access to private repos and rate-limits
  anonymous tree reads.
- `design.sample.ts` is a reference mockup, not app code. It is excluded from
  lint, format and the build. Do not import from it.

## Tests

One runnable check per non-trivial rule, using `bun:test`. Prefer pure functions
with fake `fetch`/GitHub objects. The pipeline test asserts the repo and ref are
forwarded to every GitHub call — keep that guard when refactoring.
