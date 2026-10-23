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
  - title: No server-side state
    details: Repository, provider, knobs and keys stay in the browser and travel with each request. The deployment persists nothing.
---

## Start here

| Document                        | What it answers                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------- |
| [Architecture](/architecture)   | How the pieces fit, what happens during a run, where the security boundaries are |
| [API](/api)                     | Every route, header, payload and SSE event                                       |
| [CLI](/cli)                     | Scan, generate, run and open PRs from a terminal                                 |
| [MCP server](/mcp)              | Expose EdgeSpec tools to Claude Desktop, Cursor and other agents                 |
| [Configuration](/configuration) | Browser settings, providers, pipeline knobs, sandbox runner, deployment secrets  |
| [UI](/ui)                       | Header, tabs, pipeline states, settings, theme and layout rules                  |

The repository also carries `README.md` for setup, `PLAN.md` for requirements and
`AGENTS.md` for conventions.

## The mental model

1. **The deployment stores nothing user-specific.** Settings live in the browser.
   Keys are sent as headers on each request and forwarded to the chosen provider.
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
```

Open the dashboard, enter `owner/name` in the header (or a folder path inside
it to start there), pick a provider in **Settings**, then press the run icon
in the **Pipeline** tab. For a private repository or to open a pull request,
add a GitHub token in Settings. On localhost you can also enter a local folder
path such as `./examples/hono`; the dev server scans it read-only, so you can
generate and validate tests without a GitHub repository.

CLI and MCP clients use the same Worker API:

```bash
bun --silent run cli -- scan owner/repo --limit 20
bun --silent run cli -- --help
bun run mcp -- --help
```

Checks:

```bash
bun run check          # format, lint, types, tests
bun run build          # dist/web + dist/worker
bun run deploy -- --dry-run
```

## Repository map

```text
packages/core/src/   pure pipeline logic (scanner, AI, GitHub, validation)
packages/client/src/ Worker API client shared by the CLI and MCP server
apps/worker/src/     Hono routes, bindings, durable Workflow
apps/web/src/        React dashboard
apps/cli/src/        terminal client
apps/mcp/src/        stdio MCP server
apps/docs/           this documentation site
```

Tests live in each workspace's `test/` directory.

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
