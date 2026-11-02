# EdgeSpec — Tasks

Remaining and incomplete work. This is the queue for the repository; shipped
behaviour lives in the code, tests and docs, and the previous roadmap was
retired. Each item names the gap and what "done" means. Nothing here is a
commitment to a date.

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
