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
