# EdgeSpec — Tasks

Remaining and incomplete work. `ROADMAP.md` is the shipped record; this file is
the queue. Each item names the gap and what "done" means. Nothing here is a
commitment to a date.

## Dashboard and workspace

- [ ] **Workspace and audit UI.** `GET | PUT /api/workspace` and
      `GET /api/audit` exist but the dashboard has no screen for them. Add a
      workspace section (name, retention days) and an audit table with repo
      filter. Done when a team can change retention and read audit events
      without curl.
- [ ] **Audit pagination.** `GET /api/audit` returns the newest N rows with no
      cursor. Add `before`/cursor paging if rows outgrow one page.
- [ ] **Run artifacts route.** The original roadmap listed
      `GET /api/runs/:id/artifacts` (signed R2 links); it is not implemented.
      Add it only if artifacts are actually uploaded for runs, not just drift.

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

- [ ] **R2 retention.** The daily purge deletes D1 runs, `run_files`, audit
      events, and `pr_commands`, but R2 drift artifacts are never deleted. Add
      an object-age sweep (and decide whether fixtures live in R2).
- [ ] **Export/archive before purge.** There is no export step. Add a JSON/CSV
      export if audit history must outlive the retention window.
- [ ] **Fixture storage decision.** Recorded fixtures currently travel as test
      code. Decide whether any fixture bytes go to R2, at-rest encryption, the
      retention window, and who may download them. This is the one unresolved
      decision from the original roadmap.

## Scheduled scans

- [ ] **Email drift notifications.** Only a Slack-compatible webhook is
      supported. Add email only if a provider is chosen; keep the webhook path.
- [ ] **Policy-gated drift pull requests.** Drift scans notify and never open a
      PR. Decide whether a policy may allow one draft PR per drifted repo.
- [ ] **Scheduled-path tests.** Retention purge and `drift_scan`/`retention_purge`
      audit writes have no worker test. Extract the pure pieces and cover them
      without a live D1.

## Watch mode and editor

- [ ] **VS Code extension.** Only `edgespec watch` shipped. The extension was
      the other half of 4.4; it needs a workspace scan, diff preview, apply or
      reject, and the local sandbox.
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
- [ ] **Queue-backed batch work.** Roadmap listed Cloudflare Queues for batch
      scans and PR commands; the cron and synchronous paths are sufficient at
      current volume. Add Queues when the 10-repo cron cap or command latency
      becomes a real limit.

## Documentation

- [ ] **Workspace/audit docs in the dashboard guide.** API and configuration
      docs describe both; the dashboard guide does not. Add it with the UI.
- [ ] **Deployment guide for migrations.** Document applying
      `migrations/0001`–`0007` and enabling `RUNS_DB` end to end; today this is
      spread across `wrangler.toml` comments and configuration docs.
