# @edge-spec/docs

VitePress documentation site. Markdown pages live in `apps/docs/`; configuration
and theme live in `apps/docs/.vitepress/`. The theme imports only
`@edge-spec/ui/theme.css`, so the site shares brand tokens without bundling the
dashboard components.

```bash
bun run docs:dev       # http://127.0.0.1:5174
bun run docs:build     # static site in apps/docs/.vitepress/dist
bun run docs:preview
```

Pages: overview, architecture, API, CLI, MCP, configuration, deployment and UI.
Add a page in `apps/docs/*.md` and link it in `.vitepress/config.ts` (nav and
sidebar) so it is reachable. Keep claims aligned with the code: no invented
coverage or cost, and "static check only" whenever no runner executed.
