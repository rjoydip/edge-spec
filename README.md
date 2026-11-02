# EdgeSpec

Find source files with no tests, generate a test with the AI model you choose,
validate it, and open a pull request. One Cloudflare Worker serves the API and
the dashboard.

## Prerequisites

EdgeSpec is a Bun workspace. Install these once, then `bun install` from the
repository root.

| Tool               | Version / notes                                                  |
| ------------------ | ---------------------------------------------------------------- |
| Git                | Any recent version; needed for cloning and PR workflows          |
| Bun                | `1.4.4` (pinned by `packageManager`); runs install, tests, build |
| Node.js            | `>=22.12` (declared in `engines`); used by some tooling          |
| Docker             | Optional: containerised self-hosted sandbox runs                 |
| Cloudflare profile | Only to deploy; `bun run alchemy profile edit --add Cloudflare`  |

**Linux**

```bash
curl -fsSL https://bun.sh/install | bash
# Node 22.12+ via your distribution, nvm, or fnm
curl -fsSL https://get.docker.com | sh   # optional containerised sandbox
```

`packages/sandbox` can also use `bwrap` or Podman instead of Docker.

**Windows**

Use PowerShell for Bun and Node, and keep the repository on a local drive:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
winget install OpenJS.NodeJS.LTS
```

WSL2 with Docker Desktop is needed only for containerised sandbox runs
(`bun run sandbox`); without it, validation stays a static check. Everything
else (API, dashboard, CLI, MCP, tests) runs natively. See
[`apps/docs/deployment.md`](apps/docs/deployment.md).

**macOS**

```bash
brew install oven-sh/bun/bun node@22
xcode-select --install                    # native build tools
brew install --cask docker                # optional containerised sandbox
```

Docker Desktop is optional; `bun run sandbox` uses it when present.

## Documentation

- [`apps/docs/`](apps/docs/index.md) — documentation site (VitePress), hosted on
  Cloudflare Pages at https://edge-spec-docs.pages.dev; run `bun run docs:dev`.
- [`apps/docs/deployment.md`](apps/docs/deployment.md) — D1, R2, secrets and deployment.
- [`PLAN.md`](PLAN.md) — requirements and design decisions.
- [`AGENTS.md`](AGENTS.md) — repository conventions.

```bash
bun run docs:dev      # http://127.0.0.1:5174
bun run docs:build    # static site in apps/docs/.vitepress/dist
bun run docs:deploy   # build + publish to Cloudflare Pages
bun run docs:preview  # serve the build locally
```

## Local development

```bash
bun install
bun run dev:worker     # http://127.0.0.1:8787 — API + assets, migrates local D1
bun run dev            # http://127.0.0.1:5173 — Vite, proxies /api
bun run dev:all        # both
```

`bun run dev:all` starts the API and the dashboard together. Validation stays a
static check until a sandbox runner is configured.

Build, check and evaluate:

```bash
bun run verify          # format, lint, types, tests
bun run build          # dist/web + dist/worker
bun run eval           # golden example scans (no AI, no network)
bun run deploy          # build + deploy Cloudflare (deploy:aws|vercel|fly|railway|docker|kubernetes for the rest)
bun run test:stack      # opt-in live stack test for each target, individually test:cloudflare|aws|vercel|fly|railway|docker|kubernetes
```

Alchemy applies `migrations/` during deploy and `bun run dev:worker`; there is no
separate database migration command.

## CLI and MCP

Both are thin clients of the Worker API, so start the local Worker or set
`EDGESPEC_URL`.

```bash
bun --silent run cli -- scan honojs/hono --limit 20
bun --silent run cli -- catalog
bun --silent run cli -- auth login            # confirm the code in the dashboard, approve
bun --silent run cli -- auth status
bun run mcp -- --help
```

After `auth login`, the terminal shares the profile the dashboard user
configured (AI model/key, GitHub token, sandbox runner), stored in
`~/.edgespec/auth.json`; exported env still wins. See
[`apps/docs/cli.md`](apps/docs/cli.md) and [`apps/docs/mcp.md`](apps/docs/mcp.md)
for commands, environment variables, and MCP client configuration.

## Agent skills

`skills/edge-spec/` is a portable agent skill in the open
[Agent Skills](https://agentskills.io) format used by
[skills.sh](https://www.skills.sh). It teaches a coding agent the scan →
generate → verify → pull request workflow, the environment-only secret rule and
the "static check only is not a pass" rule.

```bash
npx skills add rjoydip/edge-spec --agent opencode   # or claude-code, cursor, codex
```

The skill is documentation only: it is not bundled, built or imported by the app.

## Repository map

The repository is a Bun workspace monorepo:

```text
apps/web/        React dashboard
apps/worker/     Hono routes, bindings, durable Workflow
apps/docs/       this documentation site
packages/core/   pure pipeline logic (scanner, AI, GitHub, validation)
packages/client/ HTTP client shared by the CLI and MCP server
packages/ui/     shared React primitives and theme tokens
packages/cli/    terminal client
packages/mcp/    stdio MCP server
packages/sandbox/ self-hosted sandbox runner (bwrap/Docker/Podman/hosted)
examples/        local test-generation fixtures and reference tests
evals/           golden-scan harness and optional provider scoring
scripts/         combined dev stack
skills/          portable agent skills (skills.sh format)
```

`packages/core` is consumed as `@edge-spec/core/<module>` and the UI primitives
as `@edge-spec/ui`. Vite bundles both deployable apps into the root `dist/` for
Alchemy. Run `bun test examples` to check the examples locally.

## Configuration

The repository and branch are chosen in the header. Everything else is configured
in the dashboard's **Settings**, stored in your browser:

- **Repository** — `owner/name`, or a folder path such as `owner/name/src/app`
  to start there while the whole repository is still scanned. The branch
  dropdown appears once a repository is committed; add your GitHub token in
  Settings (needed for private repositories and for opening PRs).
- **Local project** — while the dashboard runs on localhost, the same input
  accepts a filesystem path (`C:\code\app`, `/home/me/app`, `~/app` or
  `./app`). Vite reads that folder read-only, so scan and per-file generation
  work without GitHub. The pipeline and pull request still need a repository.
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
generated suite, configure a runner in the dashboard's **Settings → Sandbox**.
It must accept:

```json
{ "files": { "src/a.ts": "…", "src/a.test.ts": "…" }, "command": "bun test" }
```

and returns `{ "exitCode": 0, "stdout": "…", "stderr": "…" }`.

### Deployment secrets

Set these before `bun run deploy`, or copy `infra/cloudflare/.env.example` to
`infra/cloudflare/.env` (git-ignored). CI passes the same names as repository secrets.

```bash
export GH_APP_ID=…                      # GitHub App auth for webhooks
export GH_APP_PRIVATE_KEY="$(cat app.pk8.pem)"  # PKCS#8 PEM
export GH_WEBHOOK_SECRET=…              # verifies x-hub-signature-256
export GH_TOKEN=…                       # fallback when no App is set
```

Other targets build the root `Dockerfile` and deploy through Alchemy:
`bun run deploy:fly`, `deploy:railway`, `deploy:docker`, `deploy:kubernetes`.
See [Deployment](apps/docs/deployment.md#_8-other-targets-vercel-aws-fly-railway-docker-kubernetes-bun).

## GitHub Actions

- **CI** (`ci.yml`) runs format, lint, types, tests and both builds on every
  push and pull request. No Cloudflare credentials required.
- **Deploy** (`deploy.yml`) builds and runs `bun run --cwd infra/cloudflare deploy --stage prod`
  on `main`, or on demand. Add `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` as repository secrets. The production cutover is
  already adopted; use **adopt** only for a new account or a lost state store.

## How a run works

`scan → generate → validate → self-correct → pull request`

The dashboard streams each phase over SSE (`POST /api/run`), so keys stay in the
request. GitHub push webhooks use the durable `TestGenerationWorkflow` with the
deployment's own Workers AI binding. When the GitHub App secrets are set, each
workflow mints a repo-scoped installation token that is cached only until just
before expiry; otherwise it falls back to `GH_TOKEN`. User keys never enter
Workflow state.
