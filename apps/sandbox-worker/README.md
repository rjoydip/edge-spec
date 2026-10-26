# @edge-spec/sandbox-worker

Cloudflare Sandbox bridge for executing generated suites. It speaks the same
`/health` and `/run` contract as `packages/sandbox`, using Containers and
`@cloudflare/sandbox`; the container image is built from `Dockerfile`.

```bash
bun run dev:sandbox-worker      # wrangler dev (needs Docker + Linux/WSL2)
bun run deploy:sandbox-worker   # builds and deploys the container
```

Set `SANDBOX_API_KEY` as a secret on this Worker; `/run` refuses requests
without it. Then point the main Worker's `SANDBOX_RUNNER_URL` at this bridge's
origin (and `SANDBOX_API_KEY` at the same key).

`wrangler dev` cannot start Containers on native Windows. Use WSL2 with Docker
Desktop, or deploy the bridge from a Linux host/CI. Without a bridge, EdgeSpec
still runs but validation stays a static check.

```bash
bun test apps/sandbox-worker
bun run --filter @edge-spec/sandbox-worker typecheck
```

See [`apps/docs/deployment.md`](../../apps/docs/deployment.md).
