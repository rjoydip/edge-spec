---
name: edge-spec
description: Find untested code in a GitHub repository and add verified bun:test coverage with EdgeSpec. Use when the user asks to find test gaps, generate tests for a repo or folder, verify a generated suite with a real runner, or open a test pull request — through the EdgeSpec MCP server or CLI.
---

# EdgeSpec

EdgeSpec scans a GitHub repository, generates a `bun:test` file with the model the user chose, validates it, and opens a pull request. It is a thin client over a Worker API, so the dashboard, CLI and MCP server always behave the same.

Use it when the task is "add tests", "what is untested", "raise coverage", or "open a PR with a test for this file".

## Rules

1. **The repository is always caller-supplied.** Ask for `owner/name` if it is missing; never invent one or default to the current remote.
2. **Secrets are environment-only.** `GH_TOKEN`, the provider key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) and sandbox keys come from the environment or the MCP client config. Never print them, never put them on a command line, never write them to a file.
3. **Report validation honestly.** `verified` is true only when a runner actually executed the suite. `static check only` means the file compiled — not that the tests passed. Never upgrade that claim.
4. **No invented metrics.** Gap risk is a path heuristic. Coverage exists only when a scan parsed an LCOV report; without one, do not quote a percentage.
5. **`watch` requires a local Worker** (`http://127.0.0.1:8787`). A deployed Worker rejects inline source; use `generate` or `run` there.

## MCP server (preferred when the tools are available)

| Tool                            | Side effect            | Use it for                                                 |
| ------------------------------- | ---------------------- | ---------------------------------------------------------- |
| `edgespec_catalog`              | none                   | Confirm provider/model and whether a sandbox is configured |
| `edgespec_scan`                 | none                   | Gaps, repository overview, OpenAPI coverage                |
| `edgespec_generate`             | calls the AI provider  | One test, validated                                        |
| `edgespec_run`                  | calls the AI provider  | Several tests in one bounded run                           |
| `edgespec_prepare_pull_request` | none                   | Validate files, get a one-time approval token              |
| `edgespec_open_pull_request`    | writes a branch and PR | Commit the approved files                                  |

Typical flow:

1. `edgespec_catalog`, then `edgespec_scan`. If there are many gaps, ask which folder or file to target before spending tokens.
2. `edgespec_generate` for a single gap, `edgespec_run` with a small `maxFiles` (1–5) for a batch.
3. Show the generated source and the exact verdict. Say "static check only" when that is what came back.
4. Pull request is two-step: prepare, show the summary and token, then open with the token. Tokens expire after ten minutes and are single-use — prepare again instead of reusing one.

Read-only resources mirror the scan: `edgespec://gaps/{owner}/{name}`, `edgespec://specs/{owner}/{name}`, `edgespec://coverage/{owner}/{name}`, `edgespec://runs/{id}`.

## CLI fallback

Run these from an EdgeSpec checkout. `bun --silent` matters: without it Bun prints a banner that corrupts `--json` output.

```bash
bun --silent run cli -- catalog
bun --silent run cli -- scan owner/repo --ref main --limit 20 --folder src/routes

OPENAI_API_KEY=... bun --silent run cli -- generate owner/repo src/auth.ts \
  --provider openai --model gpt-6-astra --out src/auth.test.ts

OPENAI_API_KEY=... bun --silent run cli -- run owner/repo --max-files 5
OPENAI_API_KEY=... bun --silent run cli -- generate owner/repo src/auth.ts --pr
```

Against a deployment instead of a local Worker:

```bash
EDGESPEC_URL=https://edge-spec.example.workers.dev bun --silent run cli -- scan owner/repo
```

`--out` writes the file; without it the test goes to stdout and the verdict to stderr, so it can be piped. `--pr` opens a pull request only when validation passes.

## Failure playbook

- **401 / no credentials** — `bun --silent run cli -- auth login` (device flow), then `auth status`. A shell `GH_TOKEN` beats the stored profile.
- **Private repository** — needs a `GH_TOKEN` with repo scope. Anonymous GitHub reads are rate-limited and private access is denied.
- **"static check only"** — no sandbox runner. Tell the user the suite was not executed; do not call it passing.
- **Validation failed** — read the individual checks in the result. Raise `--max-retries` (0–5) only when the user wants more self-correction.
- **No gaps found** — retry with the right `--ref` or narrow with `--folder`. Do not fabricate work to fill the gap.

## Do not

- Do not apply generated code unless the user asked: output stays on stdout unless `--out` or `--write` is used.
- Do not treat `--coverage-target` as measured coverage; it is advisory input to the prompt.
- Do not retry a consumed or expired PR approval token — prepare a new one.
