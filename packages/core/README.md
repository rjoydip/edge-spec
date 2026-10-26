# @edge-spec/core

Pure logic for EdgeSpec: scanning, classification, AI calls, GitHub, OpenAPI,
validation, history types and the pipeline. It imports no Hono, React or browser
globals, so the Worker, CLI, MCP server and tests all share one implementation.

Import a module directly; there is no barrel file:

```ts
import { classifyTree } from "@edge-spec/core/scanner";
import { runPipeline } from "@edge-spec/core/pipeline";
```

Key modules: `scanner.ts` (gaps and risk), `pipeline.ts` (bounded run pool),
`github.ts`, `openapi.ts` / `api-surface.ts` (contract tests and spec inference),
`coverage.ts`, `validate.ts`, `catalog.ts` (providers/models), `sandbox.ts`.

```bash
bun test packages/core
bun run --filter @edge-spec/core typecheck
```

Tests live in `test/`, not beside `src/`. Keep new rules pure and covered by a
`bun:test` case; see the root `AGENTS.md` invariants before changing validation
or metrics.
