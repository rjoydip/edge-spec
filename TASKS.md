# EdgeSpec — Tasks

Remaining and incomplete work. This is the queue for the repository; shipped
behaviour lives in the code, tests and docs, and the previous roadmap was
retired. Each item names the gap and what "done" means. Nothing here is a
commitment to a date.

## API inference

- [ ] **Mounted router prefixes.** Route extraction reads direct calls; an
      Express/Hono `app.route("/api", router)` or `.mount()` prefix is not
      composed. Add prefix resolution if inferred specs miss real endpoints.
- [ ] **Live health checks.** `overview.apiHealth` is a static matrix. A live
      endpoint check would need a booted app and a runner; keep the static
      matrix as the default and label any live result separately.
- [ ] **Inference coverage.** Add route patterns only when a real repository
      misses them; prefer a parser over more regexes if this becomes primary.

## Dashboard and workspace

- [ ] **Audit pagination.** `GET /api/audit` returns the newest N rows with no
      cursor. Add `before`/cursor paging if rows outgrow one page.

## Workspaces and tenancy

- [ ] **Multi-user workspaces.** The deployment has one lazy `default`
      workspace and no membership, roles, or invitations. This is deliberate;
      build auth (users, roles, workspace scoping) before calling it a team
      product. Until then, protect the whole Worker with an external access
      layer.
- [ ] **Per-workspace scoping in D1.** Audit and workspace queries assume the
      single workspace. Add `workspace_id` filters to every shared query when
      multi-workspace lands.
- [ ] **Per-repository retention.** Retention is one workspace window. Add a
      per-repo override only if repositories need different windows.

## Retention and storage

- [ ] **R2 retention for drift summaries.** The daily purge deletes D1 runs,
      `run_files`, audit events, `pr_commands` and the matching `runs/<id>.json`
      bundles. `drift/<repo>/<time>.json` has no row to age out; add an
      object-age sweep when drift history grows.
- [ ] **Upload raw runner reports.** The R2 run bundle holds validation check
      output and coverage facts. Raw JUnit and LCOV (when a runner produces
      them) stay in the response; upload them per run if long-lived debugging is
      needed.
- [ ] **Export/archive before purge.** There is no export step. Add a JSON/CSV
      export if audit history must outlive the retention window.
- [ ] **Fixture storage decision.** Recorded fixtures currently travel as test
      code. Decide whether any fixture bytes go to R2, at-rest encryption, the
      retention window, and who may download them. This is the one unresolved
      decision from the earlier plan.

## Scheduled scans

- [ ] **Email drift notifications.** Only a Slack-compatible webhook is
      supported. Add email only if a provider is chosen; keep the webhook path.
- [ ] **Policy-gated drift pull requests.** Drift scans notify and never open a
      PR. Decide whether a policy may allow one draft PR per drifted repo.
- [ ] **Scheduled-path tests.** Retention purge and `drift_scan`/`retention_purge`
      audit writes have no worker test. Extract the pure pieces and cover them
      without a live D1.

## Watch mode and editor

- [ ] **VS Code extension.** Only `edgespec watch` shipped. The extension is
      the other half of the editor work; it needs a workspace scan, diff
      preview, apply or reject, and the local sandbox.
- [ ] **Remote Worker support for watch.** Watch sends inline source and refuses
      anything but a local Worker. Add an opt-in path (and its trust model) if
      remote use is needed.
- [ ] **Portable recursive watch.** `fs.watch({ recursive: true })` is not
      available on every platform. Add a polling fallback for Linux setups that
      lack it.
- [ ] **Cancel in-flight generation.** Ctrl+C stops new work but does not abort
      a generation already running. Wire an `AbortSignal` through the client.
- [ ] **Git hook installer.** There is no `edgespec install-hook`; document that
      watch is manual until one exists.

## MCP

- [ ] **Resource list enumeration.** The four resources are templates only
      (`list: undefined`). Add list callbacks for the repos/runs the deployment
      can see, or keep templates and document discovery as client-driven.
- [ ] **Persistent approvals.** Approval tokens live in the stdio session and
      die on restart. Persisting them needs a trust boundary; keep them in
      memory until that exists.
- [ ] **Approval binding.** A token currently authorizes the prepared files as
      stored. If approvals ever cross processes, bind the token to a digest of
      the payload and the repository.

## Quality and evaluation

- [ ] **Eval coverage for new surfaces.** `evals/` covers generation outcomes,
      not watch, MCP resources, or workspace/audit. Add cases only where the
      outcome is measurable.
- [ ] **Mutation/flaky/eval defaults.** All remain opt-in. Revisit only with
      measured cost and flake data; do not turn them on by default.
- [ ] **Shared scan cache (KV).** Nothing is cached server-side; repeated scans
      of the same commit still pay GitHub calls. Add KV only if that becomes a
      measured cost or rate-limit problem.
- [ ] **Run the recorded product experiments.** The earlier plan named four:
      targeted vs untargeted prompts, cheap-vs-strong model routing, draft vs
      ready PRs, and comment-only vs commit-on-PR defaults. Record outcomes and
      change a default only when the measurement supports it.
- [ ] **Queue-backed batch work.** The earlier plan listed Cloudflare Queues
      for batch scans and PR commands; the cron and synchronous paths are
      sufficient at current volume. Add Queues when the 10-repo cron cap or
      command latency becomes a real limit.

## Later providers

- [ ] **Second deployment target.** Cloudflare-first is deliberate: the Worker
      uses `Workflows`, `D1`, `R2`, `AI` and `ASSETS`. Add `infra/aws.run.ts`
      with its own state and stage only when AWS/Fly/Railway/Docker/K8s is real,
      and port one seam at a time:

      | Cloudflare        | Replacement              | Seam                           |
      | ----------------- | ------------------------ | ------------------------------ |
      | Worker + `ASSETS` | container + CDN          | `apps/worker/src/index.ts`     |
      | D1                | Postgres                 | `apps/worker/src/db.ts`        |
      | R2                | S3                       | `apps/worker/src/artifacts.ts` |
      | Workflows         | queue/worker or Temporal | `packages/adapters/src/cloudflare/workflow.ts`  |
      | Workers AI        | provider HTTP APIs       | `packages/core/src/ai.ts`      |
      | `env.ts` bindings | provider config          | `apps/worker/src/env.ts`       |

      `packages/core` stays provider-neutral, so adapters belong in
      `apps/worker` and the new stack file. Do not abstract the current stack
      before that port exists.

## Non-goals

Keep these out unless the product direction explicitly changes:

- Editing application source or auto-fixing production bugs.
- A general code-review bot.
- Coverage percentages without an executed report.
- Storing user PATs or AI keys server-side.
- Autonomous merges; human approval stays for anything that leaves the session.
- Multi-language test generation before the JS/TS loop is excellent.
