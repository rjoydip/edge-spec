# AGENTS.md

Repository conventions for EdgeSpec. Read this before changing code.

## What this is

A single Cloudflare Worker that serves a React dashboard and a test-generation
API. It scans a user-supplied GitHub repository, generates a `bun:test` file
with a user-chosen AI provider, validates it, and opens a PR.

Stack: TypeScript, Hono, React 19, Tailwind v4, Vite, Wrangler, Bun.

## Commands

```bash
bun install
bun run dev:worker     # API on http://127.0.0.1:8787
bun run dev            # dashboard on http://127.0.0.1:5173 (proxies /api)
bun run docs:dev       # documentation site on http://127.0.0.1:5174
bun run docs:build     # static site in docs/.vitepress/dist
bun test               # discovers /test
bun run typecheck
bun run build
bun run check          # format:check + lint + typecheck + test
bunx wrangler deploy --dry-run
```

Run `bun run check` before claiming a change works. For a UI change, also run
`bun run build` (Tailwind class typos only fail at build time).

## Layout

- `src/core/` — pure logic. No Hono, no React, no browser globals.
- `src/worker/` — HTTP adapters (`index.ts`), bindings (`env.ts`) and the
  durable `workflow.ts`.
- `src/web/` — dashboard. `App.tsx` owns run state; components are presentational.
- `test/` — **all** unit tests. Do not colocate `*.test.ts` under `src/`.
- `docs/` — VitePress documentation site (markdown in `docs`, `.vitepress` = config/theme).
- `PLAN.md` — product requirements and review feedback.

## Invariants

1. **The deployment stores no user configuration.** Repository, provider, model,
   pipeline knobs live in `localStorage`; GitHub and AI keys are sent as headers
   (`x-github-token`, `x-ai-key`, `x-ai-base-url`) per request.
2. **Workflow params are persisted.** Never pass a user API key to
   `TestGenerationWorkflow`; it uses the deployment's Workers AI + `GITHUB_TOKEN`.
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

## Adding a provider or model

Edit `src/core/catalog.ts` only:

- Add a `Provider` with `protocol` (`workers-ai`, `openai`, `anthropic`,
  `google`) and `models`.
- `needsKey` controls whether Settings requires a key. `custom: true` is the
  private/OpenAI-compatible path and requires a base URL.
- Known providers' base URLs cannot be overridden by a request; that protects
  the user's key from being redirected.
- Add a test in `test/catalog.test.ts` if the rule changes.

## Gotchas

- In Workers, call `fetch` as a standalone function. `this.fetchImpl(...)` throws
  `Illegal invocation`; `github.ts` captures it in a local first.
- `import ... from "cloudflare:workers"` must stay external in
  `config/vite.worker.ts`; it is declared in `src/worker/cloudflare.d.ts`.
- GitHub ignores unauthenticated access to private repos and rate-limits
  anonymous tree reads.
- `design.sample.ts` is a reference mockup, not app code. It is excluded from
  lint, format and the build. Do not import from it.

## Tests

One runnable check per non-trivial rule, using `bun:test`. Prefer pure functions
with fake `fetch`/GitHub objects. The pipeline test asserts the repo and ref are
forwarded to every GitHub call — keep that guard when refactoring.
