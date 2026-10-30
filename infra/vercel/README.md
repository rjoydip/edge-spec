# Vercel

Provider-specific glue for the Vercel target.

- `handler.ts` — Web API function. It builds `Env` once per instance from
  `process.env` through `@edge-spec/runtime/adapters/node`, then delegates every
  request to the shared Hono app.
- `../../api/index.ts` — Vercel only discovers functions under the root `api/`
  directory, so this file re-exports the handler. Keep it a one-liner.
- `../../vercel.json` — must stay at the repository root. Vercel reads it from
  the project's Root Directory, and that must be the repo root so the build can
  see `dist/web`, the Bun workspaces and `packages/runtime`.

**Do not set the Vercel Root Directory to `infra/vercel`.** Vercel builds
cannot read files above the Root Directory, so the build would lose the
workspace, the app and `dist/web`.

Env: set `EDGESPEC_PROVIDER=vercel` plus the per-capability variables from
`apps/docs/deployment.md` §8. Missing explicit adapter env fails the first
request; missing provider-default env just leaves that capability off.

Deploy: `bun run deploy:vercel` runs `infra/vercel/vercel.run.ts`, a
`Command.Exec` node around `vercel deploy --prod`. It needs `VERCEL_TOKEN`,
`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. Alchemy has no Vercel provider, so the
CLI remains the deploy path.

Cron: `vercel.json` schedules `POST /api/cron/tick`; Vercel sends
`Authorization: Bearer $CRON_SECRET`, and the route 404s when the secret is
unset.
