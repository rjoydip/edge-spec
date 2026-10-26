# UI guide

The dashboard is a single agent workspace at `/`: **Repository → Agent
Activity → Gap Analysis → Review Queue**. It reads only from a scan, a run or
the D1 history, and every number shown comes from one of those; there is no
invented metric. The implementation lives in
`apps/web/src/components/agent/workspace.tsx`; `App.tsx` owns run state and the
components are presentational.

The reusable primitives live in `packages/ui`; this site consumes the same brand
tokens through `@edge-spec/ui/theme.css`.

## Page anatomy

```text
┌─ header ─────────────────────────────────────────────────────────────┐
│ mark  EdgeSpec        provider  sandbox  backlog  history  settings  │
├─ 01 Repository ──────────────────────────────────────────────────────┤
├─ 02 Agent Activity ──────────────────────────────────────────────────┤
├─ 03 Gap Analysis ────────────────────────────────────────────────────┤
└─ 04 Review Queue ────────────────────────────────────────────────────┘
```

The four cards are numbered and reveal in order. The page scrolls; no scrollbar
is visible. Accent-driven gradient glows and slowly drifting aurora blobs sit
behind the content and are `pointer-events-none`.

## Steps

1. **Repository** — repository or local-path input, branch selector, ownership
   mode, and repository facts (languages, tooling, manifest). A local path only
   works while the dashboard runs through the Vite dev server.
2. **Agent Activity** — scan, generate, validate and self-correct stages stream
   their own events. Each stage opens its log; **Facts** shows the structured
   scan facts and **Event log** the whole stream. Counts distinguish missing
   tests, coverage gaps, contract operations, unsupported and skipped files.
3. **Gap Analysis** — the gap table, risk words, inferred OpenAPI operations
   (marked as inferred when no spec exists), and the actions that start a run.
   Bulk and per-file generation are here.
4. **Review Queue** — one row per generated file with its diff, checks and
   coverage facts. Accept or reject each file; a rejected or unverified file
   never reaches a pull request. History and backlog open from the header.

## Motion

Panels rise in with a short stagger and the aurora drifts. Working nodes blink;
status text always accompanies the colour. Everything is disabled by
`prefers-reduced-motion: reduce`. While a run is active the workspace shows a
live badge and a pulsing dot on the brand mark.

## Settings

The settings sheet sections are **Provider**, **Sandbox**, **Keys**,
**Pipeline**, **Policy** and **Appearance**. Provider and sandbox settings are
also reachable from their header badges.

- **Provider** — provider, model, base URL for the private provider, and the
  matching key. Changing the provider clears the key field. Workers AI adds a
  Cloudflare account ID and token; the deployment binding is a local convenience
  only.
- **Sandbox** — provider, URL, key, concurrency and timeout. Without a runner
  validation stays **static check only**.
- **Keys** — GitHub token for private repositories and pull requests.
- **Pipeline** — coverage target, retries, files per run, strict TypeScript and
  parallel generation.
- **Policy** — opt-in PR gates.
- **Appearance** — dark/light and ten accent swatches.

Non-appearance fields are a draft: Cancel, Escape or the backdrop discards them.
Saving writes settings to `localStorage`; keys go to the browser's secret store
and are sent per request as headers. Appearance applies immediately.

## Theme and accent

The interface is built on the zinc ramp.

- **Dark** is the default. **Light** toggles `html.light`, which remaps the zinc
  ramp, borders, glass background and status colours. Components do not have
  separate light variants.
- **Accent** writes one CSS variable, `--accent-base`; derived values are mixed
  with `color-mix()` and mapped onto Tailwind's `indigo-*` utilities. Adding a
  swatch means adding an entry to `ACCENTS` in `apps/web/src/lib/theme.ts`.
- Theme and accent are applied by a small inline script before first paint, so
  there is no flash.

## Layout and scrolling rules

- The document scrolls; `html` hides its scrollbar globally.
- Inner scroll containers (terminal, code block, dialog body, tab strip) use
  `.no-scrollbar`. Keep the class on any new scrollable pane.
- Content is capped at `max-w-7xl` with responsive padding.
- Stage nodes are one column on mobile and a row on large screens.
- The gap table and preview stack until wide screens; the header actions wrap
  below the brand on small screens instead of shrinking the repository field.

## Feedback and states

- Toasts appear bottom-right for scan results, PR creation, generation failures
  and run failures; they auto-dismiss after ~4.5 seconds.
- Run failures also stream into the log; a failed validation keeps the test in
  Review with a red card and `verified: false`.
- Empty states always say what to do next (set a repository, scan, run).
- **Stop** aborts the fetch; the UI discards further events even if the
  server-side pipeline finishes its current upstream call.

## Accessibility

- Radix Dialog, Select, Switch, Slider and Tabs provide focus management,
  keyboard navigation and ARIA semantics.
- Inputs have labels or `aria-label`s; the repository field sets
  `aria-invalid` while invalid.
- Toggles use `role="switch"` with `aria-checked`; segmented choices use
  `aria-pressed`.
- Icon-only buttons have accessible names.
- Status is never colour-only: stages show status text, validation uses labels,
  risk uses words.

## Adding UI

- Reuse the primitives in `packages/ui` (`Button`, `Badge`, `Input`, `Select`,
  `Dialog`, `Switch`, `Slider`, `Tabs`, `Card`) and `cn()`; do not add raw
  controls or copy a primitive into `apps/web`.
- Use semantic tokens (`bg-zinc-*`, `text-*`, `border-*`, accent utilities)
  instead of hard-coded colours so light mode and accents keep working.
- Keep run state in `App.tsx`; presentational components take props. Settings,
  theme and secrets live in external stores under `apps/web/src/lib/`.
- Import shared shapes from `@edge-spec/core/types`; do not duplicate `Gap`,
  `Generation` or `Validation`.
