# @edge-spec/mcp

stdio MCP server wrapping the shared Worker client. It exposes six tools:
`edgespec_catalog`, `edgespec_scan`, `edgespec_run`, `edgespec_generate`,
`edgespec_prepare_pull_request` and `edgespec_open_pull_request`.

Opening a pull request requires a one-time approval token from
`edgespec_prepare_pull_request`; an unknown or reused token is refused.

```bash
bun run mcp -- --help
```

Client configuration (for example in an MCP host):

```json
{
  "mcpServers": {
    "edge-spec": {
      "command": "bun",
      "args": ["run", "packages/mcp/src/index.ts"],
      "env": { "EDGESPEC_URL": "http://127.0.0.1:8787" }
    }
  }
}
```

Secrets are environment-only, exactly like the CLI; tool arguments never carry
keys.

```bash
bun test packages/mcp
bun run --filter @edge-spec/mcp typecheck
```

See [`apps/docs/mcp.md`](../../apps/docs/mcp.md).
