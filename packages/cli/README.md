# @edge-spec/cli

Terminal client for the Worker API.

```bash
bun --silent run cli -- scan owner/repo --limit 20
bun --silent run cli -- generate owner/repo src/app.ts --out app.test.ts
bun --silent run cli -- run owner/repo --pr
bun --silent run cli -- watch ./project
bun --silent run cli -- catalog
```

Commands: `scan`, `generate`, `run`, `watch`, `catalog`. Use `--url` or
`EDGESPEC_URL` to point at a deployment; the default is
`http://127.0.0.1:8787`.

Secrets are environment-only by design: `GH_TOKEN`, `EDGESPEC_AI_KEY`
(or a provider key such as `OPENAI_API_KEY`), `EDGESPEC_AI_BASE_URL`,
`EDGESPEC_SANDBOX_URL`, `EDGESPEC_SANDBOX_KEY`, `EDGESPEC_DEPLOYMENT_AI=1`.
There are no key flags.

```bash
bun test packages/cli
bun run --filter @edge-spec/cli typecheck
```

See [`apps/docs/cli.md`](../../apps/docs/cli.md) for every option and exit code.
