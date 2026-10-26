# @edge-spec/ui

Shared React primitives and the brand theme. The dashboard imports the
components; the documentation site imports only `theme.css`.

```tsx
import { Button, Card, cn } from "@edge-spec/ui";
import "@edge-spec/ui/theme.css";
```

Components are presentational wrappers over Radix primitives. Colour comes from
tokens (`--accent-base`, the zinc ramp), not hard-coded values. Do not copy a
primitive back into `apps/web`; add it here instead.

```bash
bun test packages/ui
bun run --filter @edge-spec/ui typecheck
```

See [`apps/docs/ui.md`](../../apps/docs/ui.md) for the visual rules.
