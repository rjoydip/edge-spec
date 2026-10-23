# UI guide

The dashboard is a single page with a sticky header, five tabs, and a settings
dialog. Overview is the first tab: it is what a run needs, and every other tab
is a detail of it. Everything reads from a token-based dark/light theme with a
user-selectable accent.

The reusable primitives live in `packages/ui`; this site consumes the same brand
tokens through `@edge-spec/ui/theme.css`.

## Page anatomy

```text
┌─ header ─────────────────────────────────────────────────────────────┐
│ brand   owner/name  branch        provider badge  theme  Settings    │
├─ tabs ───────────────────────────────────────────────────────────────┤
│ Overview  Pipeline  Missing tests (n)  Review (n)                        │
├─ content ────────────────────────────────────────────────────────────┤
│ selected tab                                                         │
└──────────────────────────────────────────────────────────────────────┘
```

The page scrolls; no scrollbar is visible. Accent-driven gradient glows and
slowly drifting aurora blobs sit behind the content and are `pointer-events-none`.

## Motion

Panels and pipeline cards rise in with a short stagger, tab panels cross-fade,
the aurora drifts, and selects/dialogs use Radix state animations. All of it is
disabled by `prefers-reduced-motion: reduce`.

A run is never silent: while the pipeline runs, the **Pipeline tab** blinks and
its icon pulses, and the node that is working (Generate, Self-correct) blinks
its border and glow. The tab is a `tab-live` class and the node a
`pipeline-node-active` class, both defined in `tailwind.css`.

## Header

- Brand: the same gradient bracket mark as the favicon, **EdgeSpec**, and the
  tagline _untested code, tested_. A pulsing dot appears while a run is active.
  The mark is a button: it clears the repository, the scan, the generated tests
  and the run log, and says so.
- Repository: `owner/name`, a GitHub URL, or a folder path inside one such as
  `owner/name/src/app` or `.../tree/main/src/app`. On localhost it also accepts
  a filesystem path such as `C:\code\app`, `/home/me/app`, `~/app` or `./app`.
  Validated live. An invalid value gets a red border; it is committed on blur
  or Enter, never on every keystroke. A folder path only sets the starting
  point: the scan still covers the whole repository, and the folder's files are
  shown first. A local path is scanned read-only by the Vite dev server; the
  pipeline and pull request still need a GitHub repository.
- Branch: a dropdown fetched from GitHub once a repository is committed. It is
  not shown while the input is empty or being edited, and a folder path replaces
  it with a read-only branch chip. The branch control collapses smoothly while
  the draft changes and slides back when the value is committed, moving the
  Scan button with it. The repository's default branch is selected automatically
  and kept when valid. It is wide enough for a long branch name; a GitHub tree
  URL selects its branch.
- Provider badge: the provider's brand mark only, with the calls the provider
  says are left on a small badge (`8.4k`). A key icon flags a missing key, a
  missing base URL, or a refused request. Custom endpoints use a neutral
  fallback mark. The provider name is in the tooltip and in the Overview tab.
- Scan: an icon-only `h-9` button right after the branch control. It reads the
  repository and fills the Overview, and the reader stays on the tab they are
  on. It carries a tooltip and an accessible name. The pipeline's Run/Stop
  action lives in the Pipeline tab, not in the header.
- Theme toggle: a compact outlined sun/moon icon button, applies immediately and
  persists.
- **Settings**: an accent-filled gear plus label, visually distinct from the
  icon-only theme toggle. Opens the dialog.

All controls share one `items-center` row and an `h-9` control height. On narrow
screens the repository row wraps to its own line below the brand; the action
group stays right-aligned. This is the alignment contract — keep new header
controls at `h-9` (or icon-sized) and do not reintroduce engine names into the
chrome.

## Tabs

A horizontal pill bar, one per tab, with a count badge for the missing tests
and the ready tests. The pills carry no border: the active one is a filled
tile with a soft ring, so the row keeps its rhythm.

### Pipeline

The tab holds the run itself. The numbers, the model and the repository live in
the Overview tab, so nothing is repeated here.

- **Actions** — one icon-only button at the top right of the Pipeline card. It
  starts the run, then becomes a small rose **Stop** in the same spot while the
  run is in flight; Stop aborts the client stream. **Scan** stays in the header.
- **DAG** — five nodes: Scan, Generate, Validate, Self-correct, Pull request.
  The last node ends at _Ready to open_: a run never cuts a branch, so the pull
  request is always opened by hand from the preview pane.
  Each phase keeps its own icon colour; the status pill turns accent while
  running, green when completed, red when failed, and neutral when idle.
- **Run log** — live events with timestamps, level badges, filters. Only the
  pipeline writes here; a manual scan belongs to the Missing tests log.
  (`ALL`, `INFO`, `AI`, `WARN`, `SUCCESS`, `ERROR`), a text search and an event
  count. Click a pipeline card to show only that stage's events; click it again,
  or **Show all logs**, to return to every stage. The filter state
  (`Showing Generate · n event(s)`, or `All stages · click a stage to filter its
log`) sits inside the log header, not above the panel. Only the newest 100
  matching events are rendered; scrolling to the top prepends older pages. The
  pane follows new events while the reader is at the bottom and stops following
  once they scroll up. It has its own scroll and no scrollbar. A failed
  validation writes its full reason here, under the Validate stage.

The DAG shows self-correction even when no correction was needed; a run with
`maxRetries: 0` leaves it idle.

### Overview

The first tab: what the repository is made of, which model writes its tests,
how the results are checked, and which files are still untested.

- **Repository card** — package manager (from the lockfile), runtime and the
  version it asks for, package name and version, file counts, and the frameworks
  the configuration files reveal. It also names any **OpenAPI** spec and
  **Postman** or **Bruno** collection found while scanning, with the paths in a
  tooltip. Everything is read from the tree; nothing is invented. The scan
  itself lives in the header.
- **Model card** — the provider, the model, the base URL of a custom provider
  and the Cloudflare account of a BYOK setup. When the provider refuses a
  request — an exhausted allocation, a rate limit — the refusal stays on the
  card, so the reason is not only a toast that fades away.
- **Validation card** — the last result (`bun test`, `static only`, `failed` or
  `runner ready`) and whether a runner is configured. Without a runner the
  dashboard says so and offers to add one.
- **CI checks card** — the commands the repository itself runs, read from its
  `package.json` scripts and its GitHub Actions workflows, plus the formatter
  it uses. Every kind of check keeps its own colour and icon: format (purple),
  lint (orange), typecheck (blue), build (cyan), test (green). A generated test
  has to satisfy these before a pull request opens.
- **Languages card** — the languages by file count, with a bar per language. The
  map covers the languages a repository is likely written in: TypeScript,
  JavaScript, Python, Go, Rust, Ruby, Java, Kotlin, Swift, C#, C, C++, PHP,
  Scala, Elixir, Erlang, Haskell, Clojure, Dart, Lua, Julia, R, Nim, Zig,
  Solidity, Objective-C, Vue, Svelte, Astro, Shell, SQL, GraphQL, Terraform,
  Protocol Buffers, HTML, CSS, SCSS and Less — plus F#, OCaml, Elm, Groovy,
  PowerShell, Verilog/VHDL, GLSL, GDScript, Dockerfile, Makefile and CMake.
- **Risk & untested files card** — how many high, medium and low risk files
  there are, and how many have no test. Risk is a path heuristic, so no coverage
  percentage is claimed. **View files** opens the file tree in a modal. The tree
  has its own scroll area, and the risk level is written at the end of every row
  as **H**, **M** or **L**; `all` plus the **H**/**M**/**L** chips filter it, and
  picking a file opens it in Missing tests. The tree no longer fills the page.
- **Framework badges** — every tool keeps its own colour, so the stack reads at
  a glance.

### Missing tests

Lists source files with no sibling test. The panel is the left column; the
preview of the focused gap sits beside it on wide screens. This view is a list
only: the file tree lives in Review and in the Overview modal.

- **Header** — the gap count and a coloured summary: **generated**, **passed**,
  **validation failed** and **generation failed** counts.
- **Start folder** — when the repository input includes a folder, a thin banner
  says the scan covers the whole repository and the folder's files are shown
  first. Its clear button removes the start folder; the next scan uses the
  normal risk order.
- **Selection bar** — **Select all**, a `n selected` chip, **Generate n tests**
  and **Clear**. The button is disabled only when the selection is empty, so the
  action is always visible exactly where the count is. Generated files stay
  selectable, so a batch can regenerate tests that already exist.
- **Parallel toggle** — appears only when more than one file is selected, and
  stays hidden while the pipeline is running. **Parallel** lets a new file start
  while another generation is still in flight. The per-row sparkles/regenerate
  buttons stay enabled in parallel mode; in **Sequential** they wait for the
  current file. **Stop** cancels every running generation.
- **List rows** — a checkbox, the risk badge (`H`, `M`, `L`), the file
  path and, when a test exists, a green tick. A test that failed validation
  shows an amber warning triangle instead, and the preview explains why. At the
  end of the row sit the actions: an **info** icon for what the file is missing,
  a sky **eye** icon for the generated test, and a coloured
  **sparkles**/**refresh** icon to generate or regenerate one. A gap whose last
  generation failed shows a red alert icon; a small tooltip names the reason.
- The whole row is clickable and focuses the file in the preview.
- **Missing tests log** — the log of the gaps sits under the two panels, in the
  same terminal the pipeline uses: the same filters, the same search, the same
  scroll. A scan, a generation or a pull request lands here and never in the
  pipeline run log.
- A batch asks first: more than one file opens a confirmation dialog, because
  every file is a separate request to the model. The batch reports what it
  actually did: _N test(s) ready_ only when every file arrived, otherwise
  _N of M test(s) failed_.
- Clicking a row focuses the gap; the preview pane shows its test when one
  exists, or offers **Generate this test** when it does not.
- Empty states distinguish “no repository set” and “no missing tests yet”.

Risk is a path heuristic. The UI never renders a coverage percentage because no
coverage is measured without a runner.

### Preview pane

The right column of the Missing tests tab. There is no tab for it: the preview
always sits beside the list it belongs to.

It has two states.

**Before a test exists** — the file itself: why it is a gap, the expected test
path, the uncovered exported functions as chips, and the metadata (source, risk,
export count, test path). The generate action lives in the list, on the
sparkles icon.

**After a test exists** — the generated code and its validation:

- Code panel: test path, source path, provider/model, a `self-corrected` badge,
  and a row of coloured actions: **Copy** (sky), **Download** (cyan),
  **Passed**/**Failed** (green/amber, opens the validation modal) and
  **Regenerate** (violet). Code is highlighted by
  [Kirari](https://kirari.sh) with a palette mapped to the app's theme tokens.
  The block scrolls internally without a scrollbar.
- **Validation modal** — a summary (all checks passed, or validation failed,
  with `bun test` vs static analysis and the duration), a passed/failed/skipped
  count, and one card per repository check. Each card keeps the coloured kind
  icon (format, lint, typecheck, build, test), the check name and command, a
  tick/cross/skip pill, the duration and a note: _check succeeded_, _check
  failed_ or _tool not available in the runner_. A failing check shows its
  output. Without repository checks the modal shows the static-analysis result
  instead. Raw runner output is always visible below and scrolls on its own.
  When validation fails, the footer offers **Fix all with self-correct**: every
  failure goes back to the model, the test is rewritten, and the whole check set
  runs again. The reason is also written to the Missing tests log.
- **Open pull request** belongs to Review. A run never opens a PR on its own.
- **Regenerate this test** re-runs the model for the same file.
- The empty state says what to do next: generate the selected gap, or pick a
  test from the list.

### Review

The generated tests that are waiting to become a pull request. It is the
workbench for deciding what goes into the PR.

- The left panel is the selector: a **List** / **Files** switch, the validated /
  ready counts, and the PR actions. The file view is the repository tree drawn
  by [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees); every row
  ends with a green ✓, or `PR ✓` once a pull request exists.
- The right panel is split in two: the **original source file** on the left and
  the **generated test** on the right. Both headers show only the file name (the
  full source path is in the tooltip); a generated test is a new file, so there
  is no diff view.
- The tab appears only once a test has passed its checks. A test that failed
  validation is **hidden** here: it stays in Missing tests with an amber warning
  and the reason. The review footer says how many were hidden.
- The header shows the generated count and how many are ready for a PR.
- **Select all** and a checkbox on every ready row mark the tests for the pull
  request, the same way Missing tests selects files. With no selection,
  **Raise PR for all (n)** opens **one** pull request that carries every test
  that passed validation and has no PR yet: one branch, one commit, one review.
  With a selection, the button becomes **Open PR for selected (n)** and carries
  just those tests in one PR.
- Coloured actions on the right: **Copy** (sky), **Download** (cyan), a green
  **Passed** button that opens the same validation dialog as Missing tests, and
  **Regenerate** (violet).
- Empty state points back to Missing tests.

### Pull requests

The tab is currently **hidden** behind `SHOW_PULLS_TAB` in `apps/web/src/App.tsx`; the
component, the API client and this section stay in the code so it can be turned
back on without a rewrite.

- The 20 most recent PRs; each shows title, number, branch, state, author, date,
  and an external link.
- Compact toolbar with the open and closed counts, the repo, a shadcn `Select`
  state filter (`All states` / `Open` / `Closed`), and **Refresh**; errors from
  GitHub are shown in place.
- Empty states distinguish “no pull requests yet” from “no PRs in this state”.
  EdgeSpec opens a PR when you click **Open pull request** on a test that passed
  validation.

## Settings dialog

Uses a Radix Dialog styled like shadcn/ui: focus is trapped while open, Escape
and a backdrop click close it, and the close button is labelled. The panel is
centred with a transform and the overlay/panel animate in and out.

Sections:

1. **GitHub access** — GitHub token with **Clear**. The repository and branch are
   chosen in the header, not in Settings.
2. **Test runner** — the URL of a runner you own and its optional key. With a
   runner, the generated suite is executed, so validation is a real pass or
   fail. Without one, the dashboard only performs a static check and says so.
3. **AI provider** — provider (brand-marked select), model (select, or free text
   for the custom provider), base URL (custom only), and API key/token with
   **Clear**. A model that carries a note — the 2.5 family at Google, for
   example, which only serves accounts that have used it — shows the note under
   its name in the list. The key belongs to the provider it was issued for: changing the
   provider clears the field, so a Gemini token never sits in the box for
   another vendor. Workers AI adds a Cloudflare account ID and token, and the
   two belong together — the account says which account, the token proves it.
   Both, or neither: one without the other is refused with a clear message.
   The badge shows the mode: _BYOK: your Cloudflare account_,
   _Deployment binding (local only)_ or _Your Cloudflare account is required_.
   A deployed Worker never spends the deployment's binding, so a token is
   required there. The custom provider always exposes the key field so BYOK
   works for hosted endpoints; local servers can leave it blank.
4. **Pipeline** — Radix slider for coverage, retry buttons (0/1/2/3/5), a
   files-per-run group (1/3/5/10/25), strict TypeScript and parallel generation
   switches.
5. **Appearance** — dark/light buttons and ten centred accent swatches.
6. Footer — “Keys stay in this browser”, **Forget saved keys**, Cancel, Save.

Non-appearance fields are a draft: Cancel, Escape or the backdrop discards them.
**Save settings** writes settings and secrets to the stores. Appearance changes
apply immediately, even if the dialog is cancelled.

## Theme and accent

The interface is built on the zinc ramp.

- **Dark** is the default. **Light** toggles `html.light`, which remaps the zinc
  ramp, borders, glass background and status colours. Components do not have
  separate light variants.
- **Accent** writes one CSS variable, `--accent-base`; derived values are mixed
  with `color-mix()` and mapped onto Tailwind's `indigo-*` utilities. Adding a
  swatch means adding an entry to `ACCENTS` in `apps/web/src/lib/theme.ts`.
- Available accents: indigo (default), blue, violet, fuchsia, rose, orange,
  amber, teal, emerald, slate.
- Theme and accent are applied by a small inline script in `index.html` before
  first paint, so there is no flash.

Storage keys: `edgespec:theme` (`dark`/`light`) and `edgespec:accent` (base hex).

## Layout and scrolling rules

- The document scrolls; `html` hides its scrollbar globally.
- Inner scroll containers (page root, terminal, code block, dialog body, tab
  strip) use `.no-scrollbar`. Keep the class on any new scrollable pane.
- Content is capped at `max-w-7xl` with responsive padding.
- Pipeline nodes are one column on mobile, five on `md`.
- The list and preview panes are stacked until `xl`, then 1fr / 1.1fr.
- Header actions wrap below the brand on small screens instead of shrinking the
  repository field.

## Feedback and states

- Toasts appear bottom-right for scan results, PR creation, generation failures
  and run failures. They auto-dismiss after ~4.5 seconds and can be closed.
- Run failures also stream into the log; validation failures keep the test in
  Review with a red validation card.
- Empty states always say what to do next (set a repository, scan, run).
- The Stop action aborts the fetch; the server-side pipeline may finish its
  current upstream call, but the UI discards further events.

## Accessibility

- Radix Dialog, Select, Switch, Slider and Tabs provide focus management,
  keyboard navigation and ARIA semantics.
- Inputs have labels or `aria-label`s; the repository field sets
  `aria-invalid` while invalid.
- Toggles use `role="switch"` with `aria-checked`; segmented choices use
  `aria-pressed`.
- Icon-only buttons have accessible names.
- Status is never colour-only: nodes show status text, validation uses labels,
  risk uses words.

## Adding UI

- Reuse the shadcn-style `components/ui/` primitives (`Button`, `Badge`, `Input`,
  `Select`, `Dialog`, `Switch`, `Slider`, `Tabs`) and `cn()` rather than adding
  new dependencies or raw controls.
- Use semantic tokens (`bg-zinc-*`, `text-*`, `border-*`, accent utilities)
  instead of hard-coded colours so light mode and accents keep working.
- Keep run state in `App.tsx`; presentational components take props. Settings,
  theme and secrets live in their external stores under `apps/web/src/lib/`.
- Import shared shapes from `packages/core/src/types.ts`; do not duplicate `Gap`,
  `Generation` or `Validation`.
