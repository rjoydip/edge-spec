# CLI

`edge-spec` is a terminal client for the same Worker API the dashboard uses. It
can scan a repository, generate and validate one test, run the pipeline, and
open a pull request.

The CLI is a thin client: start the local Worker or point it at a deployment.

> `bun run` prints a command banner to stdout. The examples use
> `bun --silent run cli` so `--json` output stays parseable.

```bash
bun run dev:worker                 # http://127.0.0.1:8787
bun --silent run cli -- --help
```

```bash
EDGESPEC_URL=https://edge-spec.example.workers.dev bun --silent run cli -- scan owner/repo
```

## Commands

### Scan

```bash
bun --silent run cli -- scan honojs/hono --ref main --limit 20
```

`--folder` prioritizes gaps under a folder, because the whole repository is
still scanned. `--json` prints the full `ScanResult`.

### Generate one test

```bash
OPENAI_API_KEY=sk-... \
  bun --silent run cli -- generate owner/repo src/auth.ts \
  --provider openai --model gpt-6-astra \
  --coverage-target 80
```

Without `--out`, the generated code goes to stdout and validation goes to
stderr, so it can be piped. `--out src/auth.test.ts` writes the file instead.

```bash
OPENAI_API_KEY=sk-... bun --silent run cli -- generate owner/repo src/auth.ts \
  --provider openai --model gpt-6-astra --pr
```

`--pr` opens a pull request only when validation passes.

### Run the pipeline

```bash
OPENAI_API_KEY=sk-... bun --silent run cli -- run owner/repo --max-files 5
```

Progress is streamed to stderr. `--json` prints the final result and generated
tests instead. `--pr` opens one pull request for every ready test.

### Catalog

```bash
bun --silent run cli -- catalog
bun --silent run cli -- catalog --json
```

Lists providers, models, defaults, and whether a sandbox runner is configured.

## Options

| Option                  | Meaning                                   |
| ----------------------- | ----------------------------------------- |
| `--url <url>`           | EdgeSpec Worker URL                       |
| `--ref <ref>`           | Branch or tag; default `main`             |
| `--provider <id>`       | AI provider id                            |
| `--model <id>`          | Model id                                  |
| `--account-id <id>`     | Cloudflare account id for Workers AI BYOK |
| `--coverage-target <n>` | Advisory branch-coverage target, 0-100    |
| `--max-retries <n>`     | Self-correction attempts, 0-5             |
| `--max-ai-retries <n>`  | AI call retries, 0-5                      |
| `--max-files <n>`       | Files in one run, 1-50                    |
| `--no-strict-types`     | Disable strict TypeScript checks          |
| `--sandbox-url <url>`   | Test runner URL                           |
| `--folder <path>`       | Prioritize a folder when scanning         |
| `--limit <n>`           | Limit scan results, 1-100                 |
| `--out <file>`          | Write generated code to a file            |
| `--pr`                  | Open a pull request for passing tests     |
| `--json`                | Print machine-readable JSON               |

## Environment

Secrets are read from the environment, never from flags:

| Variable                            | Meaning                                           |
| ----------------------------------- | ------------------------------------------------- |
| `EDGESPEC_URL`                      | Worker URL; default `http://127.0.0.1:8787`       |
| `GITHUB_TOKEN`                      | GitHub token (or `EDGESPEC_GITHUB_TOKEN`)         |
| `EDGESPEC_AI_PROVIDER`              | Default provider id                               |
| `EDGESPEC_AI_MODEL`                 | Default model id                                  |
| `EDGESPEC_AI_KEY`                   | Provider key; overrides the provider-specific key |
| `EDGESPEC_AI_BASE_URL`              | Base URL for the `private` provider               |
| `OPENAI_API_KEY`                    | Key for `openai`                                  |
| `ANTHROPIC_API_KEY`                 | Key for `anthropic`                               |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Key for `google`                                  |
| `GROQ_API_KEY`                      | Key for `groq`                                    |
| `DEEPSEEK_API_KEY`                  | Key for `deepseek`                                |
| `MISTRAL_API_KEY`                   | Key for `mistral`                                 |
| `OPENROUTER_API_KEY`                | Key for `openrouter`                              |
| `CLOUDFLARE_API_TOKEN`              | Key for `workers-ai` BYOK                         |
| `CLOUDFLARE_ACCOUNT_ID`             | Account id for Workers AI BYOK                    |
| `EDGESPEC_SANDBOX_URL`              | Test runner URL                                   |
| `EDGESPEC_SANDBOX_KEY`              | Test runner key                                   |
| `EDGESPEC_DEPLOYMENT_AI=1`          | Use the deployment's Workers AI binding           |

Provider and model flags override their environment defaults. Keys stay in the
`x-github-token`, `x-ai-key`, `x-ai-base-url`, `x-sandbox-url`, and
`x-sandbox-key` request headers; the Worker does not persist them.

## Exit codes

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| `0`  | Success                                                       |
| `1`  | Validation failed, the pipeline failed, or the request failed |
| `2`  | Invalid command or arguments                                  |
