# EdgeSpec — Feature Roadmap

A feature plan grounded in what the repository already does today: a Worker that
scans a repo, finds untested units and API contract gaps, writes tests in the
repository's own runner (Bun, Vitest, Jest or Playwright), validates them
(runner optional), self-corrects, and opens a pull request. The CLI and MCP
server are API clients. The sandbox package runs suites locally or in hosted
drivers.

The plan is deliberately conservative about claims: every feature below either
measures something it actually ran, or says "not measured".

## 0. The three bets

1. **Make every run measurable and safe before making it autonomous.**
   Coverage deltas, run history, cost caps, and a hard test-only file guard.
   Without these, CI autonomy is a liability.
2. **Move the agent into the repo's workflow.** A GitHub App, PR checks,
   comment commands, scheduled drift scans, and policy gates. This is where the
   product becomes recurring instead of a one-off dashboard visit.
3. **Spend the model budget where it changes the outcome.** Coverage-targeted
   prompts, failure-aware retries, test impact analysis, flaky detection, and
   mutation scores. All runner-gated, never invented.

## 1. Where the product is today

| Capability                                                   | Status                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Scanner + AST/file tree, missing/coverage/API gaps           | Shipped (`core/scanner`)                                                                                         |
| LCOV parsing                                                 | Shipped (`core/coverage`), used for reporting only                                                               |
| OpenAPI parsing, deterministic contract tests, JUnit parsing | Shipped (`core/openapi`)                                                                                         |
| Streaming pipeline, bounded pool, self-correction            | Shipped (`core/pipeline`, SSE `/api/run`)                                                                        |
| Single-file generate                                         | Shipped (`/api/generate`)                                                                                        |
| Sandbox drivers (bwrap/Docker/Podman/E2B/Vercel/Daytona)     | Shipped (`packages/sandbox`)                                                                                     |
| PR creation with selected files                              | Shipped (`/api/pull-request`)                                                                                    |
| Durable workflow + webhook                                   | Shipped (`/webhook` → `TestGenerationWorkflow`)                                                                  |
| CLI (`scan`, `generate`, `run`, `watch`, `catalog`)          | Shipped                                                                                                          |
| MCP stdio server (6 tools, 4 resource templates)             | Shipped                                                                                                          |
| Dashboard                                                    | Shipped (event-driven workspace; History and Backlog dialogs)                                                    |
| Persistence                                                  | Optional D1 (`RUNS_DB`) for runs, backlog, memory, schedules, policies, workspace and audit; settings stay local |
| Auth                                                         | User PATs for dashboard; optional GitHub App for CI                                                              |
| Run history                                                  | Shipped (`/api/runs`, History/Compare)                                                                           |
| Policies                                                     | Shipped (dashboard + optional D1, enforced in both PR paths)                                                     |
| Scheduled drift                                              | Shipped (daily cron, webhook summary, optional R2 artifacts)                                                     |
| Backlog                                                      | Shipped (D1 items, CODEOWNERS owner, dashboard states)                                                           |
| Import graph / impact                                        | Shipped (bounded test graph, PR checks + `/api/impact`)                                                          |
| Flaky detection                                              | Shipped (repeats, quarantined, never verified)                                                                   |
| Mutation score                                               | Shipped (opt-in Stryker report, budget stop labelled)                                                            |
| Contract negatives / auth fixtures                           | Shipped (env-only fixtures, missing/wrong/unauthorized cases)                                                    |
| Record/replay API fixtures                                   | Shipped (`/api/record`, in-test mock replay, no live app)                                                        |
| Property-based tests                                         | Shipped (opt-in fast-check, labelled/seeded/bounded)                                                             |
| Test runner adapters                                         | Shipped (Bun/Vitest/Jest/Playwright detected per repo)                                                           |
| Repository memory / prompt version                           | Shipped (opt-in D1 strings, prompt version stamped)                                                              |
| Eval harness / model routing                                 | Shipped (golden cases, outcome scores, opt-in cheap-first)                                                       |
| Watch mode                                                   | Shipped (`edgespec watch`; VS Code extension not built)                                                          |
| MCP resources / approvals                                    | Shipped (4 resources, one-time PR approval token)                                                                |
| Team workspaces / audit / retention                          | Shipped (single workspace, redacted audit, daily purge)                                                          |
| Cloudflare Sandbox runner                                    | Shipped (`apps/sandbox-worker`, Containers + Sandbox SDK)                                                        |
| API inference / health matrix                                | Shipped (inferred OpenAPI, static endpoint matrix)                                                               |

The `/api/runs/:id` route reads Cloudflare Workflow status; optional D1 stores
run history, decisions, backlog, memory, schedules, policies, workspace settings
and the audit log. Remaining gaps are tracked in `TASKS.md`.

## 2. Design constraints (these shape every feature)

1. **No user keys stored.** Dashboard keys travel per request. A GitHub App for
   CI is deployment-owned credentials, not user config.
2. **Verified means executed.** No runner → "static check only", never "passed".
3. **No invented metrics.** Coverage delta only with two LCOV reports; mutation
   score only when a mutation runner ran; "risk" stays a labelled heuristic
   unless graph data backs it.
4. **Never edit app source.** The PR writer must reject any path that is not a
   test/spec artifact. This becomes a hard gate in Phase 1.
5. **Runner optional.** Every execution feature must degrade honestly.
6. **Repo is caller-supplied.** No default repository, no server-side clone.

## 3. Feature portfolio

Impact is user/business value; effort is engineering weeks for one experienced
dev. "Runner" means a working sandbox.

| #   | Feature                                                     | Impact | Effort | Needs runner | Phase |
| --- | ----------------------------------------------------------- | ------ | ------ | ------------ | ----- |
| 0.1 | Wire the redesign draft to real events                      | High   | 2      | No           | 0     |
| 1.1 | Test-only path guard + denied paths                         | High   | 1      | No           | 1     |
| 1.2 | Skip generated/vendored/migration code                      | High   | 1      | No           | 1     |
| 1.3 | Coverage delta per file + PR body                           | High   | 3      | Yes          | 1     |
| 1.4 | Coverage-targeted prompts (uncovered lines/branches)        | High   | 3      | Yes          | 1     |
| 1.5 | Run history (D1) + compare runs                             | High   | 4      | No           | 1     |
| 1.6 | Cost estimate, budget cap, provider fallback                | High   | 3      | No           | 1     |
| 1.7 | Failure diagnostics + retest failed only                    | High   | 2      | Yes          | 1     |
| 1.8 | PR provenance body (model, checks, verification, delta)     | High   | 1      | No           | 1     |
| 2.1 | GitHub App auth for CI                                      | High   | 4      | No           | 2     |
| 2.2 | PR checks: scan changed files, annotate, comment            | High   | 4      | Yes          | 2     |
| 2.3 | Policy gates (draft-only, max files, coverage floor, paths) | High   | 3      | No           | 2     |
| 2.4 | PR commands (`/edgespec retest`, `coverage`, `explain`)     | Medium | 2      | Yes          | 2     |
| 2.5 | Scheduled drift scans + notifications                       | High   | 3      | Yes          | 2     |
| 2.6 | Test-debt backlog + ownership                               | Medium | 4      | No           | 2     |
| 3.1 | Import graph + test impact analysis                         | High   | 5      | No           | 3     |
| 3.2 | Flaky detection + quarantine                                | High   | 3      | Yes          | 3     |
| 3.3 | Mutation score (budgeted)                                   | High   | 5      | Yes          | 3     |
| 3.4 | Contract negative cases + auth fixtures                     | High   | 3      | Yes          | 3     |
| 3.5 | Record/replay API fixtures                                  | High   | 5      | Yes          | 3     |
| 3.6 | Property-based tests (opt-in)                               | Medium | 2      | Yes          | 3     |
| 4.1 | Test runner adapters (vitest/jest/playwright)               | High   | 6      | Yes          | 4     |
| 4.2 | Repo memory + prompt versioning                             | Medium | 5      | No           | 4     |
| 4.3 | Eval harness + model routing                                | High   | 4      | Yes          | 4     |
| 4.4 | VS Code extension / watch mode                              | High   | 5      | Yes          | 4     |
| 4.5 | MCP resources + approval flow                               | Medium | 2      | No           | 4     |
| 4.6 | Team workspaces, audit log, retention                       | Medium | 5      | No           | 4     |

## 4. Detailed features

Every numbered feature in this section has shipped. The paragraphs keep the
original acceptance criteria as the definition of done; deviations and
follow-ups live in `TASKS.md`.

### Phase 0 — Finish the shell

**0.1 Wire the redesign to real events.**
Replace the fixtures with `RunEvent`s: `apiResults` state, stage counters, real
logs, review decisions, editable PR fields, settings that drive the request.
The `draft` fixtures were removed when parity was reached. Acceptance: every
number in the dashboard comes from an event or a scan result; no static fixture
remains.

### Phase 1 — Trust and measurement

**1.1 Test-only path guard.**
Every generation and PR file is checked against an allowlist: `*.test.*`,
`*.spec.*`, `tests/**`, `__tests__/**`, or the detected test convention.
Anything else is rejected before the request reaches GitHub.

- Where: `core/pr.ts`, `core/pipeline.ts`, `/api/pull-request`, plus a policy
  module shared with the CLI.
- Acceptance: a malicious/accidental source path fails with a named error; PR
  file list is validated again before upload.

**1.2 Skip generated, vendored, and migration paths.**
Default deny list: `vendor/`, `dist/`, `build/`, `coverage/`, migrations,
`.d.ts`, lockfiles, generated markers (`@generated`, `DO NOT EDIT`). Repos can
add to the list. The scan shows "12 skipped by policy" rather than silently
ignoring them.

- Acceptance: skipped counts appear in scan totals; no gap is generated for a
  denied path.

**1.3 Coverage delta per file.**
When a runner and LCOV are available, take a baseline before generation and a
second report after validation. Store the per-file delta (lines and branches)
with the decision. Show it in the review row and the PR body. When no runner
ran, the field is `not measured`.

- Where: `core/coverage.ts`, `core/pipeline.ts`, `RunEvent` validation payload,
  dashboard, PR body.
- Acceptance: delta exists only with two measured reports; no delta is inferred
  from the path heuristic.

**1.4 Coverage-targeted prompts.**
Pass the uncovered line ranges and branch hints for the target file into the
generation prompt ("cover lines 42–58, the `expired` branch"). Keep the prompt
bounded (top N ranges) and include the source. This is the highest-leverage
quality improvement per token.

- Where: `core/ai.ts`, `core/pipeline.ts`, `core/coverage.ts`.
- Acceptance: generated tests reference the targeted behavior; an eval fixture
  shows higher new-line coverage than the untargeted prompt.

**1.5 Run history and comparison (D1).**
Persist runs, file decisions, verification, checks, coverage snapshots, provider
and model. No keys, no prompts, no full source. Add `/api/runs` and
`/api/runs/:id/files`; the dashboard gains History and Compare views (new gaps,
coverage delta, accepted/rejected, cost).

- Schema sketch:
  `runs(id, repo, ref, status, provider, model, started_at, finished_at, totals_json, cost)`;
  `run_files(run_id, source_path, test_path, decision, verified, checks_json, coverage_json)`;
  events summarized in D1, full logs in R2.
- Acceptance: a run survives a refresh and can be compared with the previous
  one; deleting a repo's history is one action; no key/token column exists.

**1.6 Cost estimate, budget, fallback.**
Estimate input tokens from the source size + prompt, show a range before the
run, and let the user cap spend per run. On provider quota/5xx, fall back to the
next configured provider (catalog already models this) and say so in the log.

- Where: `core/ai.ts`, `core/catalog.ts`, `/api/run` input, settings.
- Acceptance: the run aborts cleanly at the cap with a partial result; fallback
  is logged, never silent; no cost is claimed for a model that did not answer.

**1.7 Failure diagnostics + retest failed only.**
Parse JUnit failures into a named diagnosis (assertion, timeout, boot error,
missing fixture). Add "Retest failed" (already hinted in the draft) that runs
only failed operations, bounded. The dashboard shows expected vs actual.

- Where: `core/openapi.ts` (JUnit), `core/pipeline.ts` retryGaps, `/api/run`.
- Acceptance: a retest touches only failed endpoints; results are labelled as a
  retest, not a fresh run.

**1.8 PR provenance body.**
The PR body states: model/provider, verification (executed vs static), checks
that ran with durations, coverage delta if measured, corrected contract tests,
skipped operations and why, and the test-only guarantee.

- Acceptance: reviewers can tell what was verified without opening the
  dashboard; the body changes when the run changes.

### Phase 2 — The agent in the repo workflow

**2.1 GitHub App auth.**
Replace PATs for CI with an App installation: mint short-lived installation
tokens server-side, scope to the repo, and never persist user secrets. The
dashboard keeps the per-request PAT path.

- Where: `apps/worker` (auth, token cache), `core/github.ts`.
- Acceptance: a webhook run works without a user token; token cache respects
  expiry; no user credential is stored.

**2.2 PR checks and changed-file scope.**
On `pull_request` open/synchronize, scan the changed files and their dependents,
run the affected tests, and publish a check run with annotations (file + line
for gaps) and a single comment summary. Default: no commits, no new PR — the
check is advisory until policy allows otherwise.

- Where: `/webhook`, `TestGenerationWorkflow`, `core/scanner`, `core/ci.ts`.
- Acceptance: a PR gets one check and one comment; re-runs update them instead
  of spamming; a repo with no runner gets a "static only" annotation.

**2.3 Policy gates.**
Per-repo policy: draft-only PRs, max files, allowed paths, require a coverage
floor/delta, require human approval, labels/reviewers, and a kill switch.
Policies live server-side for CI (opt-in) and in `localStorage` for the
dashboard; they never contain keys.

- Acceptance: a policy violation blocks the PR with a readable reason; the
  dashboard shows which gate blocked it.

**2.4 PR commands.**
`/edgespec retest`, `/edgespec coverage`, `/edgespec explain <endpoint|file>`.
Commands are authorized by the commenter's repo permission and rate-limited.

- Acceptance: unauthorized users are ignored; each command produces one reply
  and one updated check.

**2.5 Scheduled drift scans and notifications.**
Weekly (configurable) scans that detect new untested files and contract drift
since the last run. Shipped as notification-only: a summary to a Slack-
compatible webhook plus optional R2 artifacts. Opening a draft PR, email
delivery and R2 retention remain in `TASKS.md`.

- Acceptance: a quiet repo produces "no drift" and no PR; a drifted repo
  produces one actionable summary.

**2.6 Test-debt backlog and ownership.**
Turn gaps into durable items (open, accepted, rejected, ignored) with owner,
first seen, last seen, risk reason, and linked runs. CODEOWNERS maps ownership.

- Acceptance: the backlog is the source of truth across runs; closing a gap in
  code closes the item on the next scan.

### Phase 3 — Test intelligence

**3.1 Import graph and impact analysis.**
A lightweight module graph (imports/exports) powers (a) gap priority by
dependents, not path depth, and (b) "run only the tests affected by these
changes". The graph is cached per repo/ref.

- Honesty: call it "dependents" and "changed-file impact", not a risk score.
- Acceptance: a changed leaf module selects its direct and transitive test
  dependents; the dashboard explains why a test was selected.

**3.2 Flaky detection and quarantine.**
Re-run each new test N times (configurable, default 2 extra) with the same seed
where possible. A test that passes and fails is marked flaky, not "passed",
and quarantined in the PR body. Optional auto-retry once.

- Acceptance: flaky never counts as verified; the PR says "flaky, quarantined".

**3.3 Mutation score, budgeted.**
Run Stryker (or an equivalent) on changed files, capped by time/mutants. Show
the score only when the tool ran, with the number of mutants killed/survived
and the command used. Never estimate it.

- Acceptance: a missing tool shows "not measured"; a budget stop is labelled.

**3.4 Contract negative cases and auth fixtures.**
Generate negative cases from the OpenAPI schema (missing required field, wrong
type, unauthorized) and support per-environment auth fixtures (headers/query
values) that are injected into the sandbox only. This directly fixes today's
"skipped, no token fixture" endpoint.

- Acceptance: skipped endpoints become executable when a fixture exists; the
  fixture is never written to logs or the PR.

**3.5 Record/replay API fixtures.**
Record real responses from a booted app once, then replay them in CI with a
tiny mock server so contract tests stay deterministic without a live app. Diff
replays against the recorded fixtures to detect drift.

- Where: `packages/sandbox` (record mode), `core/openapi.ts` (fixture format),
  R2 (fixtures), PR artifacts.
- Acceptance: a recorded suite runs in CI with no live server; a deliberate
  schema change fails the replay.

**3.6 Property-based tests.**
Opt-in per pure module: generate `fast-check` properties from types/JSDoc and
run a bounded number of cases. Keep it opt-in because flakiness/cost is real.

- Acceptance: properties are labelled, seeded, and bounded; failures include a
  shrinking seed.

### Phase 4 — Surfaces and scale

**4.1 Runner adapters.** Support vitest/jest/playwright conventions as
first-class, detected per repo, not bolted onto `bun:test`. The PR uses the
repo's runner and assertions. Shipped: the detected runner supplies the import
style, assertions and command.

**4.2 Repo memory.** Persist accepted conventions, helpers, fixtures, and
naming per repo (opt-in, no source retention beyond chosen snippets) and feed
them into future prompts. Version the prompt so results are attributable.
Shipped as opt-in D1 strings with a prompt version stamp.

**4.3 Eval harness and routing.** Golden repos with expected gaps and outcomes;
score providers/models on verified rate, acceptance, cost, and flake rate. Route
cheap models to simple files and strong models to failures; fall back on quota.
Shipped as `evals/` with opt-in cheap-first routing.

**4.4 VS Code extension and watch mode.** Scan the open workspace, preview
diffs, apply or reject locally, and run the local sandbox. `edgespec watch`
regenerates tests for changed files before commit. Shipped as the CLI watch
mode; the VS Code extension is still open in `TASKS.md`.

**4.5 MCP resources and approvals.** Expose gaps, specs, coverage, and run
status as MCP resources; require explicit approval before a tool opens a PR.
Shipped as four read-only resource templates and a one-time approval token.

**4.6 Team workspaces.** Shared policies, backlog, and history; audit log for
autonomous actions; retention controls; no secrets. This intentionally relaxes
"the deployment stores no user configuration": policies are workspace data,
not keys, and are opt-in. Shipped as one lazy `default` workspace per
deployment (name, retention, redacted audit, daily purge). Multi-user
membership and roles remain in `TASKS.md`.

## 5. Architecture today

### Data (D1 and R2)

- **D1 (`RUNS_DB`, opt-in)**: `runs`, `run_files`, `pr_commands`,
  `drift_snapshots`, `backlog_items`, `repo_memory`, `policies`, `workspaces`
  and `audit_events`. Migrations live in `migrations/0001`–`0007`.
- **R2 (`ARTIFACTS`, optional)**: drift summaries at
  `drift/<repo>/<timestamp>.json`. Run logs and JUnit/LCOV artifacts are not
  uploaded yet; retention does not touch R2.
- **Cron**: one daily trigger (`0 8 * * *`) applies workspace retention and runs
  due repository schedules. There is no Queue binding.
- **Secrets**: GitHub App id/private key, webhook secret, optional drift webhook
  secret, sandbox URL/key. Never user PATs for CI.

### Routes (as implemented)

```sh
GET    /api/health                 GET    /api/quota
GET    /api/catalog                GET    /api/branches
POST   /api/scan                   POST   /api/coverage
POST   /api/impact                 POST   /api/record
POST   /api/run                    POST   /api/generate
POST   /api/pull-request           GET    /api/pulls
GET    /api/runs                   GET    /api/runs/:id
DELETE /api/runs                   GET    /api/runs/:id/files
POST   /api/runs/:id/decisions     POST   /api/sandbox/health
GET    /api/backlog                PATCH  /api/backlog
GET    /api/schedules              PUT    /api/schedules
DELETE /api/schedules              GET    /api/memory
PUT    /api/memory                 DELETE /api/memory
GET    /api/policies               PUT    /api/policies
DELETE /api/policies               GET    /api/workspace
PUT    /api/workspace              GET    /api/audit
POST   /webhook                    GET    /local-api/scan
GET    /local-api/file
```

There is no signed-artifact route yet; see `TASKS.md`.

### Packages

- `packages/core` — pure scanner, coverage, OpenAPI, pipeline, GitHub, policy,
  memory, drift, impact, history, routing and eval logic.
- `packages/client` — typed HTTP client shared by the CLI and MCP server.
- `packages/ui` — React primitives and `theme.css` brand tokens.
- `packages/cli` — `scan`, `generate`, `run`, `watch`, `catalog`.
- `packages/mcp` — stdio server with six tools and four resource templates.
- `packages/sandbox` — bwrap/Docker/Podman plus hosted SDK drivers.
- `apps/sandbox-worker` — Cloudflare Sandbox bridge (Containers + Sandbox SDK).
- `apps/worker`, `apps/web`, `apps/docs` — the deployment, dashboard and docs.

### Dashboard

Shipped: the event-driven workspace, History/Compare, Backlog, policy editor,
Settings, and the review queue. Workspace/audit screens are still open; see
`TASKS.md`.

## 6. Delivery plan

| Phase | Weeks   | Scope                                                                                            | Exit criteria                                        |
| ----- | ------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 0     | 2       | Wire the redesign; test-only guard                                                               | No fixtures left; source paths rejected              |
| 1     | 6       | Coverage delta/targeting, D1 history, cost, diagnostics, PR body                                 | A run is reproducible, comparable, and honest        |
| 2     | 8       | GitHub App, PR checks, policies, commands, schedule, backlog                                     | One repo runs on PRs with no PAT and no surprise PRs |
| 3     | 10      | Import graph/impact, flaky, mutation, contract negatives/fixtures, record/replay, property tests | Quality signals are measured, not claimed            |
| 4     | ongoing | Runner adapters, memory, evals/routing, VS Code/watch, MCP, teams                                | The loop improves with usage and scales to teams     |

All four phases are delivered; the table is the original estimate, kept for
comparison. Remaining and incomplete work is queued in `TASKS.md` rather than
added as a fifth phase.

## 7. Metrics and guardrails

Product metrics: verified rate, acceptance rate per generated file, PR merge
rate, new-line coverage per accepted test, time-to-green, cost per verified
test, flake rate, impact-analysis precision, CI minutes saved, weekly active
repos.

Guardrail metrics: **0** PRs touching non-test paths, **0** stored user keys,
**0** "verified" claims without an execution, **0** coverage numbers without
LCOV, **0** silently skipped endpoints.

Experiments: targeted vs untargeted prompts; cheap-vs-strong model routing;
draft PR vs ready PR; comment-only vs commit-on-PR defaults.

## 8. Risks

| Risk                                     | Mitigation                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| Model cost explodes with reruns/mutation | Per-run budget, per-feature caps, cheap-first routing                          |
| GitHub rate limits                       | App installation tokens, ETag cache, changed-file scope                        |
| D1 write volume from events              | Summaries in D1, full logs stay in the stream until R2 upload lands (TASKS.md) |
| Flaky verification erodes trust          | Repeat runs, quarantine, never count flaky as passed                           |
| Sandbox cold starts                      | Warm pools, image cache, per-repo setup cache                                  |
| Contract tests need a live app           | Record/replay fixtures (3.5)                                                   |
| Policy bypass / source edits             | Path guard enforced at generation and PR upload                                |
| Privacy of run history                   | Opt-in, redaction, retention, per-repo delete                                  |
| Feature sprawl                           | Each feature must improve verified rate, acceptance, or cost/verified test     |

## 9. Non-goals

- Editing application source or auto-fixing production bugs.
- A general code-review bot.
- Coverage percentages without an executed report.
- Storing user PATs or AI keys server-side.
- Autonomous merges. Human approval stays for anything that leaves the session.
- Multi-language test generation before the JS/TS loop is excellent.

## 10. Open decisions

The original decisions were resolved by the shipped design:

1. **CI distribution** — GitHub App first, with `GITHUB_TOKEN` and per-request
   PATs as fallbacks.
2. **Persistence default** — opt-in `RUNS_DB`; the Worker still runs without it.
3. **Policy storage** — per-repo D1 for CI plus the dashboard's local copy; no
   keys in either.
4. **Runner priority** — Bun first, with per-repo adapter detection.
5. **Mutation/flaky defaults** — off by default; opt-in per repository.

One decision remains open and is tracked in `TASKS.md`: fixture storage and
access policy (R2 vs test code, encryption, retention, download rights).
