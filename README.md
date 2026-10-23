# EdgeSpec

Find source files with no tests, generate a test with the AI model you choose,
validate it, and open a pull request. One Cloudflare Worker serves the API and
the dashboard.

## Documentation

- [`apps/docs/`](apps/docs/index.md) — documentation site (VitePress); run `bun run docs:dev`.
- [`PLAN.md`](PLAN.md) — requirements and design decisions.
- [`AGENTS.md`](AGENTS.md) — repository conventions.

```bash
bun run docs:dev      # http://127.0.0.1:5174
bun run docs:build    # static site in apps/docs/.vitepress/dist
bun run docs:preview  # serve the build locally
```

## Local development

```bash
bun install
bun run dev:worker     # http://127.0.0.1:8787 — API + assets
bun run dev            # http://127.0.0.1:5173 — Vite, proxies /api
```

Build and check:

```bash
bun run check          # format, lint, types, tests
bun run build          # dist/web + dist/worker
bun run deploy -- --dry-run
```

## CLI and MCP

Both are thin clients of the Worker API, so start the local Worker or set
`EDGESPEC_URL`.

```bash
bun --silent run cli -- scan honojs/hono --limit 20
bun --silent run cli -- catalog
bun run mcp -- --help
```

See [`apps/docs/cli.md`](apps/docs/cli.md) and [`apps/docs/mcp.md`](apps/docs/mcp.md)
for commands, environment variables, and MCP client configuration.

## Repository map

The repository is a Bun workspace monorepo:

```text
apps/web/        React dashboard
apps/worker/     Hono routes, bindings, durable Workflow
apps/cli/        terminal client
apps/mcp/        stdio MCP server
apps/docs/       this documentation site
packages/core/   pure pipeline logic (scanner, AI, GitHub, validation)
packages/client/ HTTP client shared by the CLI and MCP server
packages/ui/     shared React primitives and theme tokens
```

`packages/core` is consumed as `@edge-spec/core/<module>` and the UI primitives
as `@edge-spec/ui`. Vite bundles both deployable apps into the root `dist/` for
Wrangler.

## Configuration

The repository and branch are chosen in the header. Everything else is configured
in the dashboard's **Settings**, stored in your browser:

- **Repository** — `owner/name`, or a folder path such as `owner/name/src/app`
  to start there while the whole repository is still scanned. The branch
  dropdown appears once a repository is committed; add your GitHub token in
  Settings (needed for private repositories and for opening PRs).
- **AI provider** — Cloudflare Workers AI uses the deployment binding, or your
  own account ID + API token for BYOK. OpenAI, Anthropic, Gemini, Groq, DeepSeek,
  Mistral and OpenRouter use your key. **Private / self-hosted** accepts any
  OpenAI-compatible base URL (vLLM, Ollama, LiteLLM, an internal gateway) with an
  optional key.
- **Pipeline** — coverage target, self-correction retries, auto-PR, strict
  TypeScript.
- **Appearance** — dark/light and ten accent colours.

Keys are sent to the Worker as request headers (`x-github-token`, `x-ai-key`,
`x-ai-base-url`) and forwarded to the provider. The deployment never persists
them.

### Sandbox validation

Without a runner, EdgeSpec reports **static check only**. To execute the
generated suite, point `SANDBOX_RUNNER_URL` at a service that accepts:

```json
{ "files": { "src/a.ts": "…", "src/a.test.ts": "…" }, "command": "bun test" }
```

and returns `{ "exitCode": 0, "stdout": "…", "stderr": "…" }`.

### Deployment secrets

```bash
bunx wrangler secret put GITHUB_TOKEN            # webhook automation only
bunx wrangler secret put GITHUB_WEBHOOK_SECRET   # verifies x-hub-signature-256
bunx wrangler secret put SANDBOX_RUNNER_URL
bunx wrangler secret put SANDBOX_API_KEY
```

## GitHub Actions

- **CI** (`ci.yml`) runs format, lint, types, tests and both builds on every
  push and pull request. No Cloudflare credentials required.
- **Deploy** (`deploy.yml`) builds and runs `wrangler deploy` on `main`, or on
  demand. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository
  secrets.

## How a run works

`scan → generate → validate → self-correct → pull request`

The dashboard streams each phase over SSE (`POST /api/run`), so keys stay in the
request. GitHub push webhooks use the durable `TestGenerationWorkflow` with the
deployment's own Workers AI binding and token; user keys never enter Workflow
state.
