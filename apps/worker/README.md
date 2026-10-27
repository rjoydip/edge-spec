# @edge-spec/worker

The single Cloudflare Worker: Hono HTTP routes, SSE streaming for `/api/run`,
the durable `TestGenerationWorkflow`, D1 history and R2 artifacts.

```bash
bun run dev:worker     # builds the bundle, then alchemy dev on :8787
bun run --filter @edge-spec/worker build
bun run deploy         # build + alchemy deploy --stage prod
```

- `src/index.ts` — routes, header parsing, SSE framing.
- `src/workflow.ts` — webhook automation; deployment-owned credentials only.
- `src/db.ts` — D1 queries for history, backlog, policies, schedules, audit.
- `src/artifacts.ts` — R2 bundles (`runs/<id>.json`).
- `src/scheduled.ts` — daily drift scans and retention.
- `src/env.ts` — the binding surface, typed without Workers globals.

Bindings come from `infra/alchemy.run.ts`: `ASSETS`, `AI`, `RUNS_DB` (D1),
`ARTIFACTS` (R2), `TEST_GENERATION_WORKFLOW`, plus optional sandbox and GitHub
App secrets. Without D1/R2 the routes answer `enabled: false`; a run still works.

```bash
bun test apps/worker
bun run --filter @edge-spec/worker typecheck
```

See [`apps/docs/api.md`](../../apps/docs/api.md) and
[`apps/docs/deployment.md`](../../apps/docs/deployment.md).
