# EdgeSpec — Agent Workspace Redesign

Branch: `feat/agent-redesign` (from `feat/sandbox`).
Scope: dashboard UX/UI only. No CLI, MCP, Worker-route or contract-test changes
unless a phase says so explicitly.

## 1. Goal

Replace the current tabbed dashboard with the four-step agent workspace in the
approved wireframe, using the existing design language (zinc ramp, `--accent-base`,
glass panels, accent aurora, no visible scrollbar, `h-9` header) and adding one
new thing: a live, colorful, animated run.

Non-goals:

- No new backend endpoints. The stream, scan and PR routes already exist.
- No invented metrics. A stage shows a count only when an event supplied it.
- No new app-patching behaviour. EdgeSpec regenerates tests; it never edits
  application source. Copy must say that out loud.

## 2. What exists today (read before editing)

| Area             | Reality                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell            | `apps/web/src/App.tsx` (1136 lines) owns run state, `Tabs` (overview / pipeline / gaps / review / pulls).                                                  |
| Header           | `components/header.tsx` owns repo input, branch `Select`, scan button, quota, theme toggle, Settings.                                                      |
| Live run         | `components/pipeline.tsx`: 5 nodes (scan, generate, validate, correct, pull-request) + filtered log.                                                       |
| Endpoint results | `RunEvent` already carries `{ type: "api", results: ApiTestResult[] }`, but `App.tsx` drops it (`case "api": break;`).                                     |
| Contract tests   | Dormant: the dashboard never sends `mode`, so `apiMode` is false and no contract suite runs. The Worker already accepts `mode: "unit" \| "api" \| "both"`. |
| "Fixed" evidence | None. A contract suite runs once (`pipeline.ts:798`), after file generation; there is no baseline/retest pair.                                             |
| Design tokens    | `packages/ui/src/theme.css` (brand) + `apps/web/src/tailwind.css` (zinc remap, accent mix, keyframes).                                                     |
| Primitives       | `packages/ui/src/components/*` — 12 hand-written shadcn-style files, variant maps, no `cva`.                                                               |

## 3. The four stages

User-facing labels stay exactly as requested. Each stage maps to existing
pipeline events; nothing is re-sequenced in the backend for v1.

| Stage | Label                                            | Backed by                                                                     | Counter                                                     |
| ----- | ------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1     | Cloning & Parsing AST / File Tree                | `step: scan`, then `gaps` (`overview`, `totals`)                              | `overview.totalFiles` files · `overview.sourceFiles` source |
| 2     | Analyzing Missing Test Files & Code Gaps         | `gaps` + `totals`                                                             | `gaps.length` gaps (`totals.missing`, `totals.api`)         |
| 3     | Testing OpenSpec Endpoints (Live execution)      | `api` results + `step: validate` for spec gaps                                | `passed / total` operations                                 |
| 4     | Auto-fixing failing endpoints & generating tests | `step: generate`, `step: correct`, `generation`, `validation`, `result.ready` | `ready / maxFiles` tests                                    |

Honesty rules baked into the UI:

- Stage 3 reads **"Not verified"**, never `0/0`, when no runner is configured
  (`Validation.verified === false`).
- Stage 3 label keeps the requested wording; its subline reads
  _"contract tests, live runner required"_.
- Stage 4 subline reads _"regenerates the test file, not your app"_.
- The four stages overlap in wall-clock time (the pool generates files while
  earlier files validate). The rail therefore shows per-stage counters and a
  live ring on any stage currently producing events — it is not a linear
  progress bar pretending to be a queue. (Raw order is scan → file
  generate/validate/correct → contract suite; the wireframe puts contract
  testing before fixing, so a strict sequence would be a lie.)

## 4. Layout

```
+-------------------------------------------------------------------------+
| [EdgeSpec]                    [Quota] [Settings] [Avatar ▾]             |
+-------------------------------------------------------------------------+
| Step 1 · Target Repository                                              |
| [ https://github.com/org/repo.git            ] [main ▾]                 |
| Mode: (•) Interactive Review   ( ) Fully Autonomous     [ Start Scan ]  |
+-------------------------------------------------------------------------+
| Step 2 · Live Pipeline Telemetry                                        |
| [✓] Cloned Repo -> [✓] Scanned AST -> [>] Testing OpenSpec (12/14)      |
| [▸ Live log & repo facts]                                               |
+-------------------------------------------------------------------------+
| Step 3 · Triage & Findings                                              |
| +-----------------------+ +-------------------------------------------+ |
| | File Tree / Gaps (14) | | OpenAPI Endpoint Health                    | |
| | 📄 src/auth.ts (No t.)| | GET  /api/v1/users   [200 OK]             | |
| | 📄 src/edge.ts (Gap)  | | POST /api/v1/sync    [500 -> unverified]  | |
| +-----------------------+ +-------------------------------------------+ |
+-------------------------------------------------------------------------+
| Step 4 · Code Diff Review                                               |
| 📂 src/auth.test.ts (Generated)          [Regenerate] [Accept]          |
| +---------------------------------------------------------------------+ |
| | + describe('Auth Edge Runtime', ...)                                | |
| +---------------------------------------------------------------------+ |
+-------------------------------------------------------------------------+
| [Cancel]                                    [ Dispatch Pull Request ]  |
+-------------------------------------------------------------------------+
```

### Region → component → data

| Region | Component                                                     | Data / notes                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bar    | `components/header.tsx` (slimmed)                             | brand, quota `Badge`, Settings `Button`, `Avatar` + `DropdownMenu` (theme, keys, pull requests, reset). No auth exists — avatar is initials of the repo owner or "Guest"; no fake profile API.                                         |
| Step 1 | new `components/agent/step-repo.tsx`                          | moves the existing repo/branch logic out of `header.tsx` (`parseRepoInput`, `fetchBranches`, local-path support). `RadioGroup` for mode. `Button` = scan.                                                                              |
| Step 2 | new `components/agent/step-rail.tsx` + `lib/stages.ts`        | `Progress`, `Separator`, `Tooltip`, `Badge`, `Collapsible`. Log preview → existing `TerminalPanel` inside a `Sheet`. Repo facts → existing `Overview` in a `Tabs` panel ("Live log" / "Repo facts").                                   |
| Step 3 | new `components/agent/step-triage.tsx`, `endpoint-matrix.tsx` | left: existing `Gaps`/`path-tree` in `ScrollArea` + `Card`; right: `Table` fed by new `apiResults` state, `Badge` per HTTP status, `Popover` for error/params, `Skeleton` while running. `Editor`/params raw via existing `code-view`. |
| Step 4 | new `components/agent/step-review.tsx`                        | wraps existing `Preview` + `review` actions. File picker = `Select`/`DropdownMenu`; `Alert` when static-check-only; diff body unchanged (`code-view` + Kirari).                                                                        |
| Footer | new `components/agent/run-footer.tsx`                         | sticky glass bar, `h-9` controls. Contextual primary action: Start Scan → Stop → Dispatch PR. `Cancel` = `AlertDialog` when a run is in flight.                                                                                        |

Tabs are removed as top-level navigation. Their content is rehomed:
Pipeline → Step 2; Missing tests → Step 3 left; Review → Step 4; Overview →
Step 2 "Repo facts"; Pull requests → header `DropdownMenu` → `Dialog` with the
existing `Pulls` component (`SHOW_PULLS_TAB` and the `Tab` type are deleted).

## 5. Design language

### Color

Add five semantic stage hues as tokens in `apps/web/src/tailwind.css` (invariant
7: tokens, not duplicate components), each with a dark value, a `-soft`
background value and a light-mode remap:

| Token             | Hues    | Used by                        |
| ----------------- | ------- | ------------------------------ |
| `--stage-clone`   | sky     | Step 1, rail node 1            |
| `--stage-analyze` | violet  | Step 2, rail node 2            |
| `--stage-test`    | amber   | Stage 3, matrix "not verified" |
| `--stage-fix`     | fuchsia | Stage 4, fix chips             |
| `--stage-review`  | emerald | Step 4, Accept/Dispatch        |

Why not `indigo-*`: the accent swatches rewrite the whole indigo ramp, so a
stage coloured `indigo` changes colour when the user picks a new accent. Keep
the accent for the primary action, focus ring and aurora only.

Status colours keep their meaning: emerald passed, rose failed, amber
warning/not-run, zinc idle. Dark and light values must be checked against
`--background`; the light remap already in `tailwind.css` is the pattern.

### Motion

Existing keyframes are reused (`app-reveal`, `aurora-drift`, `pipeline-node`,
`tab-live`, `status-live`, `toast-in`, `dialog-in`, `tab-in`). New, all CSS:

| Name            | Where                 | Rule                                                      |
| --------------- | --------------------- | --------------------------------------------------------- |
| `rail-fill`     | `Progress` indicator  | width transition + one sheen; no per-tick JS animation    |
| `node-ping`     | active rail node      | single ring ping, not an infinite pulse                   |
| `row-in`        | matrix rows           | 24 ms stagger, capped at 12 rows                          |
| `line-in`       | diff lines            | 12 ms stagger, capped at 30 lines (rest render instantly) |
| `shimmer`       | `Skeleton`            | gradient sweep                                            |
| `success-burst` | footer on `result.ok` | three CSS dots, no confetti dependency                    |

`prefers-reduced-motion` already collapses all animations globally — keep that
override authoritative and do not add JS-driven motion.

### Alignment with the current design

- `glass-panel` cards, `rounded-2xl`, `text-[10px]` mono badges, `size-3.5`
  icons — unchanged.
- Header row stays one `items-center` line, controls `h-9`/icon-sized (invariant 8).
- Page scrolls, scrollbar hidden; inner panes use `.no-scrollbar` (invariant 6).
- Accent setting still recolours buttons, focus rings and the aurora.

## 6. shadcn components

"Use all types" is interpreted as every primitive the layout actually uses.
Adding all ~50 shadcn files would ship ~25 unused dependencies — listed as
skipped below so the decision is visible.

### Add to `packages/ui` (17)

`card`, `progress`, `table`, `tooltip`, `dropdown-menu`, `popover`,
`radio-group`, `checkbox`, `separator`, `scroll-area`, `skeleton`,
`collapsible`, `accordion`, `alert`, `avatar`, `alert-dialog`, `sheet`.

Written in the repo's existing style: plain variant maps, `cn()` from
`lib/utils`, no `class-variance-authority`, no `components.json`, no CLI. The
Tailwind paths already cover `packages/ui/src`.

New Radix deps in `packages/ui/package.json` (12): `react-progress`,
`react-tooltip`, `react-dropdown-menu`, `react-popover`, `react-radio-group`,
`react-checkbox`, `react-separator`, `react-scroll-area`, `react-collapsible`,
`react-accordion`, `react-alert-dialog`, `react-avatar`. `card`, `table`,
`skeleton`, `alert`, `sheet` are plain elements + existing `dialog`.

### Reuse (6)

`button`, `badge`, `input`, `select`, `tabs`, `dialog`, plus `textarea`,
`switch`, `slider`, `context-menu` (Settings, file right-click), `view-tabs`.

### Skip, with reason

| Skipped                                                          | Why                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `chart`                                                          | Stage sparkline is a `Progress`; a chart lib for one metric is not worth it   |
| `sonner`                                                         | Existing toast in `App.tsx` already works; migrate only if stacking is needed |
| `command`                                                        | No command palette in this scope                                              |
| `calendar`, `input-otp`, `form`                                  | No date, OTP or form-library surface                                          |
| `carousel`, `hover-card`, `menubar`, `navigation-menu`           | Nothing needs them                                                            |
| `pagination`, `data-table`, `sidebar`, `resizable`, `breadcrumb` | Matrix is one table; steps are the breadcrumb                                 |
| `toggle`, `toggle-group`, `aspect-ratio`, `label`                | `label` comes with existing fields; add on demand                             |
| `drawer`                                                         | `sheet` covers the mobile drawer                                              |
| `skeleton` variants                                              | one shape is enough                                                           |

Add a skipped primitive when a screen genuinely needs it — not before.

## 7. Files

### New

```
packages/ui/src/components/{card,progress,table,tooltip,dropdown-menu,popover,
  radio-group,checkbox,separator,scroll-area,skeleton,collapsible,accordion,
  alert,avatar,alert-dialog,sheet}.tsx
apps/web/src/components/agent/step-repo.tsx
apps/web/src/components/agent/step-rail.tsx
apps/web/src/components/agent/step-triage.tsx
apps/web/src/components/agent/endpoint-matrix.tsx
apps/web/src/components/agent/step-review.tsx
apps/web/src/components/agent/run-footer.tsx
apps/web/src/lib/stages.ts
apps/web/test/stages.test.ts
```

### Modified

```
packages/ui/src/index.ts                 export the 17 primitives
packages/ui/test/exports.test.ts         assert the new exports
packages/ui/package.json                 12 Radix deps
apps/web/src/tailwind.css                stage tokens + 6 keyframes
apps/web/src/App.tsx                     shell + apiResults + step state + mode
apps/web/src/components/header.tsx       slim to brand/quota/settings/avatar
apps/web/src/components/pipeline.tsx     becomes rail + log preview (node metadata moves to lib/stages.ts)
apps/web/src/lib/settings.ts             Settings.mode: "review" | "autonomous"
apps/web/src/api.ts                      send mode: "both" on /api/run
apps/docs/ui.md                          page anatomy + motion sections
```

### Deleted / moves

- `type Tab`, `TABS`, `SHOW_PULLS_TAB`, tab bar JSX in `App.tsx`.
- Repo/branch/scan controls move from `header.tsx` to `step-repo.tsx`.
- `overview.tsx`, `gaps.tsx`, `preview.tsx`, `review.tsx`, `terminal.tsx`,
  `pulls.tsx`, `settings.tsx` are reused, not rewritten.

## 8. State and data changes

### `App.tsx`

```ts
step: 1 | 2 | 3 | 4              // replaces `tab`; jumps allowed only to reached steps
apiResults: ApiTestResult[]      // new: stop dropping the "api" event
apiPhase: "baseline" | "retest"  // for the "-> Fixed" chip (P5)
mode: Settings["mode"]           // new, localStorage
autoDispatched: useRef(false)    // one auto-dispatch per run in autonomous mode
```

- `case "api": setApiResults((prev) => merge(prev, event.results)); break;`
  Keyed by `specPath + method + path`.
- `setTab("review")` → `setStep(4)`; `setTab("gaps")` → `setStep(3)`.
- `resetAll` also clears `apiResults` and returns to step 1.
- `step` auto-advances on: `gaps` → 2; first `generation` → 3; first ready
  `result` → 4. A user who manually picks a step is not yanked back.

### `lib/stages.ts` (pure, tested)

```ts
stageStates(input): Stage[]
// { id, label, sublabel, state: "idle"|"running"|"done"|"failed",
//   done?: number, total?: number, note?: string }
```

Test asserts: no counts before data; stage 3 is `not-run` without a runner;
stage 4 reports `ready/maxFiles`; a failed stage never renders as done.

### `api.ts`

Add `mode: "both"` to the `/api/run` body. Empty `apiSpecs` makes it a no-op,
and it wakes up the contract testing the Worker and pipeline already support.
Add `mode?: "unit" | "api" | "both"` to `RunInput` in `packages/core/src/types.ts`.

### `settings.ts`

`mode: "review" | "autonomous"` in `Settings`, default `"review"`, stored in
`localStorage` like every other knob (invariant 1). Interactive = review each
diff, dispatch by hand. Autonomous = auto-advance steps and call the existing
`openPullWithFiles` once after `result.ok`; it still shows the diff and never
skips validation. Local-path projects stay interactive (no GitHub).

### `pipeline.ts` — only for the "→ Fixed" chip (P5)

```ts
| { type: "api"; results: ApiTestResult[]; phase?: "baseline" | "retest" }
```

Emit `phase: "baseline"` on the current run; after a failed baseline with a
sandbox configured, re-run the same contract file **once** and emit
`phase: "retest"`. UI: `failed baseline + passed retest` renders
`[500 Error → test fixed]` with a tooltip _"the contract test was corrected;
the app was not modified"_. No sandbox → `[not verified]`, no chip.

If P5 is cut: the chip reads `[500 Error → test generated]`. Never "endpoint
fixed".

## 9. Phases

Each phase is a commit that typechecks, builds and is manually reviewable.

| Phase | Work                                                                                                                               | Check                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| P0    | 17 primitives, exports, Radix deps, stage tokens, keyframes                                                                        | `bun run check`, `bun run build`, exports test                                          |
| P1    | Slim header, `step-repo`, `step-rail`, `stages.ts`, footer skeleton; old tabs still reachable behind a dev-only flag for visual QA | `bun run dev` + `dev:worker`: empty state, local path, invalid repo, light/dark, 375 px |
| P2    | Step 3 triage: `apiResults` state, `mode: "both"`, matrix, sheets                                                                  | scan a repo with an OpenAPI spec; verify `12/14` matches `api` events                   |
| P3    | Step 4 review: `Preview` wrapper, Accept/Regenerate, static-only `Alert`, sticky footer, Dispatch PR                               | run without sandbox → must say "static check only"                                      |
| P4    | Delete tabs/`SHOW_PULLS_TAB`, rehome Pulls to header dialog, autonomous mode, motion polish, mobile                                | full run + autonomous run opens exactly one PR                                          |
| P5    | Retest for the "→ Fixed" chip (optional, core + one event field)                                                                   | failure with sandbox shows `→ test fixed`; without sandbox shows `not verified`         |
| P6    | Docs: `apps/docs/ui.md` page anatomy, motion table, one line in `AGENTS.md` if the tab invariant changes                           | `bun run check`                                                                         |

Final gate: `bun run check` and `bun run build` (Tailwind class typos only fail
at build time). Manual matrix: empty, invalid repo, local path, no-runner,
sandbox, provider error, rate limit, 375 px, light, reduced motion.

## 10. Guardrails

1. **No invented metrics.** Every number comes from an event. Missing data
   renders `—` or "not run", never `0` or `0%`.
2. **Verified means executed.** Stage 3/4 read `Validation.verified`; no runner
   is "static check only" (invariant 3).
3. **Keys stay in headers.** The new UI adds no key fields, no key state.
4. **Deployment stores nothing.** Mode and step progress are local only; the
   Worker is unchanged.
5. **Repo is caller-supplied.** Step 1 keeps `parseRepoInput` and the local-path
   guard; no default repository.
6. **Tokens only.** No inline hex; every new colour has a light remap.
7. **Primitives in `packages/ui`.** Nothing copied into `apps/web`.
8. **Header stays aligned.** Brand + quota + Settings + avatar, one `h-9` row.
9. **Page scrolls, no scrollbar.** Sticky footer must not introduce one.
10. **Don't break the pipeline test.** `packages/core/test/pipeline.test.ts`
    asserts repo/ref forwarding — only touch `pipeline.ts` in P5.

## 11. Risks

| Risk                                                              | Mitigation                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `App.tsx` is 1136 lines and the shell rewrite touches everything  | Extract the shell only; leave handlers, toasts and SSE logic untouched                                        |
| Rail implies a linear queue that the pooled pipeline doesn't have | Per-stage counters + independent live state (section 3)                                                       |
| 12 new Radix deps grow the bundle                                 | Measure `dist/` before/after P0; primitives are tree-shaken per component                                     |
| Light-mode neon stage hues                                        | Explicit light remap + contrast check per phase                                                               |
| Mobile Step 3 two-column layout breaks                            | Matrix becomes rows-as-cards under `md`; tree collapses above it                                              |
| "Fixed" overclaim                                                 | P5 only, baseline+retest evidence, tooltip says the app was not modified                                      |
| Autonomous mode opens PRs unattended                              | One dispatch per run, `autoDispatched` ref, still gated on `result.ok`, first-run confirmation stored locally |

## 12. Decisions needed

1. **Tabs**: delete them (recommended) or keep as secondary navigation inside
   steps? Deleting means Overview lives in Step 2 and Pull requests in the
   header menu.
2. **"→ Fixed"**: ship P5 retest, or label `test generated` only?
3. **Autonomous mode**: auto-dispatch the PR, or only auto-accept and leave
   Dispatch to the footer button (recommended if the client is risk-averse)?
