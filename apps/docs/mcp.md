# MCP server

See [CLI](./cli.md) for the full environment reference; the MCP server uses the
same variables and the same Worker API.

`edge-spec-mcp` is a local stdio MCP server. It exposes EdgeSpec to an MCP client
such as Claude Desktop, Cursor, or another agent. It calls the configured Worker,
so the pipeline, sandbox, and Workers AI binding stay in the deployment.

```bash
bun run mcp -- --help
```

## Client configuration

Use an absolute path to the server entry point:

```json
{
  "mcpServers": {
    "edgespec": {
      "command": "bun",
      "args": ["/absolute/path/to/edge-spec/packages/mcp/src/index.ts"],
      "env": {
        "EDGESPEC_URL": "https://edge-spec.example.workers.dev",
        "GITHUB_TOKEN": "ghp_...",
        "EDGESPEC_AI_PROVIDER": "openai",
        "EDGESPEC_AI_MODEL": "gpt-6-astra",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

For local development, point `EDGESPEC_URL` at `http://127.0.0.1:8787` and start
`bun run dev:worker`.

> MCP uses stdio. Configure the client with the direct script path above, not
> `bun run mcp`: `bun run` prints its command banner to stdout, which would
> corrupt the JSON-RPC stream.

## Tools

| Tool                            | Side effects           | Purpose                                            |
| ------------------------------- | ---------------------- | -------------------------------------------------- |
| `edgespec_catalog`              | Read-only              | Providers, models, defaults, sandbox availability  |
| `edgespec_scan`                 | Read-only              | Gaps and repository overview                       |
| `edgespec_generate`             | Calls the AI provider  | Generate and validate one test                     |
| `edgespec_run`                  | Calls the AI provider  | Generate and validate several tests                |
| `edgespec_prepare_pull_request` | Read-only              | Validate files and issue a one-time approval token |
| `edgespec_open_pull_request`    | Writes a branch and PR | Commit the approved files                          |

`edgespec_generate` and `edgespec_run` return the generated code and validation
details. `edgespec_run` also returns the ready source paths and logs.

Opening a pull request is two-step. `edgespec_prepare_pull_request` returns an
`approvalId`, an expiry and a readable summary; show that to the user. The
client must then call `edgespec_open_pull_request` with only the token. Tokens
expire after ten minutes and are consumed on first use.

## Resources

| URI                                  | Contents                                  |
| ------------------------------------ | ----------------------------------------- |
| `edgespec://gaps/{owner}/{name}`     | Missing tests, contract gaps and totals   |
| `edgespec://specs/{owner}/{name}`    | Parsed OpenAPI specs and artifact paths   |
| `edgespec://coverage/{owner}/{name}` | Coverage status and gaps from a scan      |
| `edgespec://runs/{id}`               | Durable Workflow status for a webhook run |

Resources are read-only and use the same environment credentials as the tools.

## Environment

| Variable                   | Meaning                                           |
| -------------------------- | ------------------------------------------------- |
| `EDGESPEC_URL`             | Worker URL; default `http://127.0.0.1:8787`       |
| `GITHUB_TOKEN`             | GitHub token (or `EDGESPEC_GITHUB_TOKEN`)         |
| `EDGESPEC_AI_PROVIDER`     | Default provider id                               |
| `EDGESPEC_AI_MODEL`        | Default model id                                  |
| `EDGESPEC_AI_KEY`          | Provider key; overrides the provider-specific key |
| `EDGESPEC_AI_BASE_URL`     | Base URL for the `private` provider               |
| `CLOUDFLARE_ACCOUNT_ID`    | Account id for Workers AI BYOK                    |
| `EDGESPEC_SANDBOX_URL`     | Test runner URL                                   |
| `EDGESPEC_SANDBOX_KEY`     | Test runner key                                   |
| `EDGESPEC_DEPLOYMENT_AI=1` | Use the deployment's Workers AI binding           |

Provider-specific keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, and
`OPENROUTER_API_KEY` are also recognized.

## Safety

- Secrets live in the MCP client's environment, not in tool arguments or the
  conversation.
- The server is local; it does not expose a public HTTP endpoint.
- Scanning and resources are read-only. Generation costs an AI call. Opening a
  pull request writes to GitHub and is gated by a one-time approval token from
  `edgespec_prepare_pull_request`.
- Validation is honest: without a sandbox runner the result says **static check
  only**, not executed.
