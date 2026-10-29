# EdgeSpec — GitHub App listing

Find source files with no tests, generate a test with the AI model you choose,
validate it, and open a pull request. One Cloudflare Worker serves the API and
the dashboard.

## Field map

| GitHub field           | Value                                                                     |
| ---------------------- | ------------------------------------------------------------------------- |
| App name               | `EdgeSpec`                                                                |
| Description            | the short description block below                                         |
| Homepage URL           | `https://edge-spec-docs.pages.dev`                                        |
| Webhook URL            | `https://<your-worker>/webhook`                                           |
| Setup URL              | `https://edge-spec-docs.pages.dev`                                        |
| Callback URL           | none — installation tokens, no OAuth sign-in                              |
| Webhook secret         | set a random 32-byte value, then as deployment secret `GH_WEBHOOK_SECRET` |
| Repository permissions | Contents RW, Pull requests RW, Checks RW, Issues RW, Metadata read        |
| Events                 | Push, Pull request, Issue comment                                         |

## Short description (paste into the Description field)

```text
Finds untested code in your repository, writes bun:test suites with AI, validates them, and opens a pull request for review. EdgeSpec never edits your application source.
```

## Long description

<!-- long description: start -->

EdgeSpec finds source files and API routes that have no tests, writes a
`bun:test` suite for them, validates the result, and opens a pull request. It
adds tests — it never rewrites your application code.

Install it on one repository or all of them, and review what it proposes. Merge
what you like, ask for changes in review, or close the pull request; nothing is
merged on your behalf.

### What happens after you install

1. GitHub sends a webhook on every push, and on pull requests that are opened,
   updated, or reopened.
2. On a push, EdgeSpec scans that branch, picks the highest-risk untested source,
   and asks its AI model for a `bun:test` file for it.
3. The file is type-checked and, when a validation runner is configured,
   executed. A failing file gets a bounded self-correction pass.
4. The file is committed to a branch named
   `edgespec/test-<source>-<timestamp>` and opened as a pull request titled
   `test: add unit tests for <path>`.
5. On a pull request, EdgeSpec is read-only: it finds the tests affected by the
   changed files, runs them, and publishes the result as a check on the commit.
   It does not generate or commit anything there.
6. Maintainers can comment `/edgespec retest`, `/edgespec coverage`, or
   `/edgespec explain <endpoint>` to re-run, report, or explain the result
   without leaving the pull request.

No repository configuration is required to start. Uninstalling the app, or
removing a repository from its installation, stops all activity immediately.

### What EdgeSpec writes

- One test file per run, next to the source it covers (`src/users.test.ts` for
  `src/users.ts`), on a dedicated `edgespec/*` branch.
- One pull request with that file and the validation result in its body.
- Nothing else: no source edits, no commits to your default branch, no tags and
  no releases.

### Permissions and why they are requested

| Permission    | Access           | Why                                            |
| ------------- | ---------------- | ---------------------------------------------- |
| Contents      | Read and write   | Read your source and commit the generated test |
| Pull requests | Read and write   | Open, update, and comment on the pull request  |
| Checks        | Read and write   | Publish the validation result on the commit    |
| Issues        | Read and write   | Apply policy labels on the pull request        |
| Metadata      | Read (automatic) | Repository name, language, and default branch  |

EdgeSpec asks for no organization, member, or administration scopes. It uses a
short-lived installation token that GitHub issues per repository and cannot be
used outside the installation.

### Honest about validation

- A result is marked **verified** only when a runner actually executed the
  suite. Without one, EdgeSpec reports **static check only** — never "passed".
- Untested-code risk is a path heuristic. There is no coverage percentage unless
  your runner produced LCOV data.
- Generated tests are proposals. Review them as you would a human's pull
  request: the app optimises for useful coverage, not for being right every
  time.

### Data and privacy

- Repository content is read to scan and generate tests. Generated files and run
  history are kept in the service's own storage with a retention window
  (30 days by default); nothing is posted anywhere except the pull request.
- GitHub credentials are short-lived installation tokens. No personal access
  token is stored for an installation.
- Uninstalling the app revokes access and stops new runs. Existing pull requests
  stay in your repository until you close them.

### Requirements

- A GitHub repository with a JavaScript or TypeScript codebase (Bun test runner)
  is the best-supported case. Other setups are scanned, but generated files may
  need small edits.
- Private repositories are supported.

### Support

- Documentation: <https://edge-spec-docs.pages.dev>
- Setup guide: <https://edge-spec-docs.pages.dev/github-app>
- Source, issues, feature requests: <https://github.com/rjoydip/edge-spec>
- Security reports: open a private advisory on the repository, not a public
  issue.

<!-- long description: end -->

## Marketplace extras (only if listing publicly)

- **Categories:** Developer tools, Testing, AI.
- **Pricing:** Free.
- **Privacy policy URL:** add one before listing — the "Data and privacy" section
  above is not a substitute for a hosted policy.
- **Screenshots:** dashboard run view, the generated pull request with its
  validation summary, and a `/edgespec explain` comment. Export at 1280×800.
- **Self-hosting:** the service is a Cloudflare Worker; operators can deploy
  their own from <https://github.com/rjoydip/edge-spec>. Mention this only in
  support docs, not in the listing headline.
