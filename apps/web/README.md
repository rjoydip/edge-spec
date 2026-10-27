# @edge-spec/web

React 19 + Vite dashboard served by the Worker from `dist/web`. `App.tsx` owns
run state; components under `src/components/` are presentational. The workspace
itself lives in `src/components/agent/workspace.tsx`.

```bash
bun run dev            # http://127.0.0.1:5173, proxies /api and /local-api
bun run build          # writes dist/web
```

Settings, theme and secrets live under `src/lib/` and in the browser
(`localStorage` plus the secret store). Keys are sent to the Worker as request
headers, never persisted server-side. Tailwind v4 tokens are in
`src/tailwind.css`; shared primitives come from `@edge-spec/ui`.

```bash
bun test apps/web
bun run --filter @edge-spec/web typecheck
bun run --filter @edge-spec/web build
```

UI changes need the build: a typo in a Tailwind class only fails there. See
[`apps/docs/ui.md`](../../apps/docs/ui.md).
