---
layout: home

hero:
  name: EdgeSpec
  text: Untested code, tested.
  tagline: Scan a GitHub repository, generate a test with the model you choose, validate it honestly, and open a pull request.
  actions:
    - theme: brand
      text: Explore the docs
      link: /architecture
    - theme: alt
      text: API reference
      link: /api

features:
  - title: Your model, your key
    details: Workers AI out of the box, or OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, OpenRouter and any OpenAI-compatible custom endpoint.
  - title: Honest validation
    details: Static checks always run. A suite is only reported as verified when a sandbox runner actually executed `bun test`.
  - title: No server-side user config
    details: Repository, provider, knobs and keys stay in the browser and travel with each request. Optional D1 stores shared run history, not credentials.
---

## Start here

| Document                        | What it answers                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------- |
| [Architecture](/architecture)   | How the pieces fit, what happens during a run, where the security boundaries are |
| [API](/api)                     | Every route, header, payload and SSE event                                       |
| [CLI](/cli)                     | Scan, generate, run and open PRs from a terminal                                 |
| [MCP server](/mcp)              | Expose EdgeSpec tools to Claude Desktop, Cursor and other agents                 |
| [Configuration](/configuration) | Browser settings, providers, pipeline knobs, sandbox runner, deployment secrets  |
| [Deployment](/deployment)       | D1, R2, secrets, Worker deployment, CI                                           |
| [UI](/ui)                       | Workspace steps, pipeline states, settings, theme and layout rules               |

The repository also carries `README.md` for setup, `PLAN.md` for requirements and
`AGENTS.md` for conventions.

## The mental model

1. **The deployment stores no user configuration.** Settings live in the browser.
   Keys are sent as headers on each request and forwarded to the chosen provider.
   Run history, the backlog, policies and audit are optional shared D1 state;
   they never hold source text, prompts or keys.
2. **One pipeline, two transports.** `runPipeline()` streams the interactive run
   over SSE (`POST /api/run`). GitHub webhooks use the durable
   `TestGenerationWorkflow` with deployment-owned credentials.
3. **Validation is honest.** Without a sandbox runner, a test is reported as
   _static check only_ — never as passing. Gap risk is a path heuristic, not a
   coverage percentage.
4. **The repository is always supplied by the caller.** There is no default
   repository on the server.

## Quick start

```bash
bun install
bun run dev:worker     # API + built assets on http://127.0.0.1:8787
bun run dev            # Vite dashboard on http://127.0.0.1:5173
bun run dev:all        # both
```

Open the dashboard, enter `owner/name` in **01 Repository** (or a folder path),
pick a provider in **Settings**, then scan and start a run. For a private
repository or to open a pull request, add a GitHub token in Settings. On
localhost you can also enter a local folder path such as
`./examples/missing-openapi`; the dev server scans it read-only, so you can
generate and validate tests without a GitHub repository. A folder path is only
available through the Vite dev server.

CLI and MCP clients use the same Worker API:

```bash
bun --silent run cli -- scan owner/repo --limit 20
bun --silent run cli -- --help
bun run mcp -- --help
```

Checks:

```bash
bun run verify          # format, lint, types, tests
bun run build          # dist/web + dist/worker
bun run deploy -- --dry-run
```

## Repository map

```text
packages/core/src/   pure pipeline logic (scanner, AI, GitHub, validation)
packages/client/src/ Worker API client shared by the CLI and MCP server
packages/ui/src/     shared React primitives and theme tokens
packages/cli/src/    terminal client
packages/mcp/src/    stdio MCP server
packages/sandbox/src/ self-hosted sandbox runner
apps/worker/src/     Hono routes, bindings, durable Workflow
apps/web/src/        React dashboard
apps/docs/           this documentation site
evals/               golden-scan harness and optional provider scoring
```

Tests live in each workspace's `test/` directory. Deployment steps are in
[Deployment](/deployment).

## Limits at a glance

| Limit                         | Value                                                               |
| ----------------------------- | ------------------------------------------------------------------- |
| Repository input              | `owner/name`, GitHub URL, folder path, or localhost filesystem path |
| Scan results in the dashboard | 25 gaps, first 8 enriched with exported symbols                     |
| Pipeline target               | first gap only, per run                                             |
| Self-correction retries       | 0–5, default 2                                                      |
| Coverage target               | 0–100, default 90 (advisory to the model)                           |
| Provider / sandbox timeout    | 120 seconds per call                                                |
| Generated test size           | up to 4096 output tokens                                            |
| Pull request list             | 20 most recent, all states                                          |
