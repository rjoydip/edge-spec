# @edge-spec/worker

Cloudflare-only deployment of EdgeSpec. The shared app lives in
`packages/runtime`; this workspace holds just the pieces that must talk to Workers
bindings.

```bash
bun run dev:worker     # builds the bundle, then alchemy dev on :8787
bun run --filter @edge-spec/worker build
bun run deploy         # build + alchemy deploy --stage prod
```

- `src/index.ts` — Worker entry (`fetch`, `scheduled`, Workflow export).
- `src/workflow.ts` — Cloudflare Workflows adapter over
  `@edge-spec/runtime/jobs`.
- `src/kv.ts` — KV cache adapter (`CacheStore`).
- `src/cloudflare.d.ts` — the `cloudflare:workers` module declaration.

Everything else comes from `@edge-spec/runtime`: routes (`app`), ports (`env`),
adapters, jobs, SQL, artifacts and the Bun entry. Bindings come from
`infra/cloudflare/cloudflare.run.ts`: `ASSETS`, `AI`, `RUNS_DB` (D1),
`ARTIFACTS` (R2), `CACHE` (KV) and `TEST_GENERATION_WORKFLOW`, plus optional
sandbox and GitHub App secrets.

```bash
bun test apps/worker
bun run --filter @edge-spec/worker typecheck
```

See [`apps/docs/api.md`](../../apps/docs/api.md) and
[`apps/docs/deployment.md`](../../apps/docs/deployment.md).
