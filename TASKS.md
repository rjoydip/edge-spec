# EdgeSpec — Tasks

Remaining and incomplete work. This is the queue for the repository; shipped
behaviour lives in the code, tests and docs, and the previous roadmap was
retired. Each item names the gap and what "done" means. Nothing here is a
commitment to a date.

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
- [x] **Retention purge audit test.** The cron tick test covers the fixed
      retention purge and its `retention_purge` audit row without a live D1.
- [ ] **Drift scan audit test.** `scanRepo` still needs a GitHub seam before the
      `drift_scan` audit row can be covered without a live repository.

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
      not MCP resources or audit. Add cases only where the outcome is
      measurable.
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
