# Configuration

EdgeSpec has two configuration surfaces:

1. **Project selector** — repository and branch, chosen directly in the header.
   Stored separately from Settings and sent per request.
2. **Browser settings** — provider, model, secrets, pipeline knobs, appearance.
   Sent per request; never stored by the deployment.
3. **Deployment configuration** — Cloudflare bindings, optional secrets for the
   webhook/automation path, and the optional sandbox runner.

## Project selector

Enter `owner/name` in the header. The branch dropdown is fetched from GitHub
once a repository is committed; the default branch is selected automatically.
While the input is being edited the branch control collapses away, so it always
reflects the saved repository; it returns when the new value is committed. An
optional folder path — `owner/name/src/app` or a GitHub tree URL — starts the
dashboard in that folder, but the scan and the pipeline still cover the whole
repository. The branch dropdown is replaced by a read-only chip in that mode; a
tree URL, or clearing the folder, chooses the branch. Both the repository and
branch are required for every run, and there is no server-side default.

| Value      | Default   | Effect                                                                |
| ---------- | --------- | --------------------------------------------------------------------- |
| Repository | _(empty)_ | `owner/name`; required for every run                                  |
| Folder     | _(none)_  | Start folder; only changes the order, never the scan scope            |
| Branch     | default   | Ref used for tree, file reads, and as the PR base; a tree URL sets it |

## Browser settings

Open **Settings** in the header for everything except the repository.

| Setting                 | Default                                    | Effect                                                                |
| ----------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| Provider                | `workers-ai`                               | See the provider table                                                |
| Model                   | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | A catalog model, or free text for the custom provider                 |
| Base URL                | _(empty)_                                  | Custom provider only                                                  |
| Cloudflare account ID   | _(empty)_                                  | Optional; Workers AI BYOK with an API token                           |
| GitHub token            | _(empty)_                                  | Private repos, higher rate limits, branches/commits/PRs               |
| AI key                  | _(empty)_                                  | Required for known providers; optional (BYOK) for the custom provider |
| Coverage target         | `90`                                       | Advisory prompt goal, 0–100 (clamped)                                 |
| Self-correction retries | `2`                                        | 0–5 (clamped)                                                         |
| Parallel generation     | on                                         | Generate several tests side by side when more than one is picked      |
| Files per run           | `10`                                       | How many gap files one pipeline run covers, 1–50 (clamped)            |
| Test runner URL         | _(empty)_                                  | A runner you own that executes the suite, so validation is a real run |
| Strict TypeScript       | on                                         | Reject `any`, `as any` and `@ts-ignore`-style suppressions            |
| Appearance              | dark / indigo                              | Immediate theme and accent                                            |

### Storage keys

| Key                     | Purpose                               |
| ----------------------- | ------------------------------------- |
| `edgespec:project`      | Repository, branch and start folder   |
| `edgespec:settings`     | JSON of the non-secret settings above |
| `edgespec:github-token` | GitHub token                          |
| `edgespec:ai-key`       | Provider key                          |
| `edgespec:sandbox-key`  | Key for your own test runner          |
| `edgespec:theme`        | `dark` or `light`                     |
| `edgespec:accent`       | Accent base hex                       |

Settings save on **Save settings** (appearance applies immediately). **Forget
saved keys** clears both secrets. Corrupt or unavailable `localStorage` falls
back to defaults; private browsing may keep values for the session only.

### Secret transport

Non-secret settings live in the JSON body. Secrets travel as headers:

```text
x-github-token: ghp_…
x-ai-key: sk-…
x-ai-base-url: http://localhost:11434/v1
x-sandbox-url: https://runner.example.com
x-sandbox-key: runner-key
x-deployment-ai: 1
```

`x-ai-base-url` is only attached when the provider is `private` (the custom
provider). The Worker forwards the key to the chosen provider and does not log
or persist it.

`x-sandbox-url` and `x-sandbox-key` are only attached when **Test runner URL**
is set in Settings. They point the Worker at a runner you own, so the generated
suite is executed instead of only checked statically.

`x-deployment-ai` asks the Worker for its own Workers AI binding. The dashboard
only sends it while developing locally, so a deployed Worker never spends the
owner's quota for a visitor.

> Keys in `localStorage` are readable by any script on the origin. This is a
> single-user tool, not a multi-tenant secret store. Use short-lived keys, and
> **Forget saved keys** on shared machines.

## Providers

| ID           | Name                  | Protocol                 | Key      | Base URL                                    |
| ------------ | --------------------- | ------------------------ | -------- | ------------------------------------------- |
| `workers-ai` | Cloudflare Workers AI | Binding or OpenAI REST   | Optional | Binding `AI`, or your account + token       |
| `openai`     | OpenAI                | OpenAI                   | Yes      | `https://api.openai.com/v1`                 |
| `anthropic`  | Anthropic             | Anthropic Messages       | Yes      | `https://api.anthropic.com`                 |
| `google`     | Google Gemini         | Gemini `generateContent` | Yes      | `https://generativelanguage.googleapis.com` |
| `groq`       | Groq                  | OpenAI                   | Yes      | `https://api.groq.com/openai/v1`            |
| `deepseek`   | DeepSeek              | OpenAI                   | Yes      | `https://api.deepseek.com/v1`               |
| `mistral`    | Mistral               | OpenAI                   | Yes      | `https://api.mistral.ai/v1`                 |
| `openrouter` | OpenRouter            | OpenAI                   | Yes      | `https://openrouter.ai/api/v1`              |
| `private`    | Custom provider       | OpenAI-compatible        | Optional | Your URL                                    |

Models offered in Settings come from `packages/core/src/catalog.ts`. The Worker rejects a
model that is not in the selected **known** provider's list, so changing the
catalog is the only way to add one. The custom provider accepts any model name.

### Cloudflare Workers AI BYOK

On a deployed Worker, Workers AI runs on **your** Cloudflare account: add both
a 32-character account ID and a Cloudflare API token in Settings. The Worker
then calls Cloudflare's OpenAI-compatible endpoint:

```text
POST https://api.cloudflare.com/client/v4/accounts/<account-id>/ai/v1/chat/completions
Authorization: Bearer <cloudflare-api-token>
```

Both values are required, and they belong together: the account ID says which
Cloudflare account, the API token proves it. Filling in one without the other
is refused with a clear message. The deployment's `AI` binding is a local
development convenience: the dashboard only asks for it with `x-deployment-ai`, which it
sends on localhost only. A deployed Worker without your own account fails with
a clear message. The token travels in `x-ai-key`; the account ID is non-secret
and travels in the request body. Webhook automation remains binding-only.

### Custom provider (BYOK)

Any OpenAI-compatible endpoint works: vLLM, Ollama, LiteLLM, an internal
gateway, or a hosted provider that is not in the catalog. Add your own key in
Settings; it stays in the browser and travels per request.

The Worker calls:

```text
POST <baseUrl>/chat/completions
Authorization: Bearer <key>      (only if a key is set)
```

Rules:

- The URL must parse and use `http:` or `https:`. A trailing `/` is stripped.
- The model name is free text and required.
- The key is optional, so local servers with no auth work.
- A base URL supplied for any other provider is ignored by the Worker. This
  prevents a request from redirecting a real provider key to an arbitrary host.
- The Worker must be able to reach the URL. A `localhost` URL only works when
  the Worker runs on that network; a deployed Worker cannot reach your laptop.

### Workers AI

The deployment needs an `AI` binding (present in `wrangler.toml`). It is the only
provider that needs no user key. Workers AI always executes remotely, so local
`wrangler dev` may report the binding as unsupported until you are logged in and
using remote resources. For local UI work, an OpenAI-compatible provider or the
custom path is simpler.

## Pipeline knobs

| Knob                 | Default | Bounds  | Notes                                                         |
| -------------------- | ------- | ------- | ------------------------------------------------------------- |
| `coverageTarget`     | 90      | 0–100   | Prompt guidance only; no coverage is measured                 |
| `maxRetries`         | 2       | 0–5     | Extra generations after a failed validation                   |
| `parallelGeneration` | true    | boolean | Generate the picked tests in parallel instead of one by one   |
| `maxFiles`           | 10      | 1–50    | How many gap files one pipeline run generates a test for      |
| `strictTypes`        | true    | boolean | Rejects explicit `any`, `as any`, and TS suppression comments |

Bad values are clamped, not rejected. `strictTypes` and `parallelGeneration`
default to true
unless the request explicitly sends `false`.

A run covers the first `maxFiles` gaps, highest risk first, and every test it
writes waits in **Review** for a pull request.

## Sandbox runner (optional)

A runner executes the generated suite, so the result is a real pass or fail
instead of a static check. Without one, the dashboard shows **static check
only** and `validation.verified` is false.

There are two ways to point at a runner:

1. **Settings → Test runner URL.** The URL travels in the `x-sandbox-url`
   header and its key in `x-sandbox-key`. The Worker calls it, so it has to be
   reachable from the internet; `http://localhost` only works with a Worker
   running on your own machine. Only `https` is accepted, apart from a local
   runner.
2. **Deployment secret.** `SANDBOX_RUNNER_URL` (and `SANDBOX_API_KEY`) is used
   when the request carries no runner of its own.

The Worker sends:

```json
{
  "files": {
    "src/math.ts": "export const add = (a, b) => a + b;",
    "src/math.test.ts": "import { describe, it, expect } from \"bun:test\";\n…"
  },
  "command": "bun test"
}
```

with `authorization: Bearer <SANDBOX_API_KEY>` when a key is configured, and a
120-second timeout.

The AI call itself gets 180 seconds. A provider that is merely slow is told
apart from one that is gone: the request ends with _the provider did not answer
within 180 seconds_, never with _unreachable_.

It expects:

```json
{ "exitCode": 0, "stdout": "…", "stderr": "…" }
```

### The repository's own checks

EdgeSpec reads the commands the repository runs — the scripts of
`package.json` and the `run:` steps of `.github/workflows/*.yml` — and runs
them against the generated test, so CI does not fail on a file the model
wrote:

| Command       | What it does                                                    |
| ------------- | --------------------------------------------------------------- |
| the formatter | rewrites the generated file with the repository's own formatter |
| lint          | the lint command of the manifest or the workflow                |
| typecheck     | the type check command                                          |
| build         | the build command                                               |
| test          | the test command, besides `bun test` on the generated file      |

A failing check fails the validation, and the failure output is fed back into
the self-correction loop, so the model gets a second attempt with the exact
error. A check whose tool is missing in the runner is reported as _not
runnable here_, never as a pass.

The runner may also return the files it ended up with, which is how the
formatter hands back the formatted code:

```json
{ "exitCode": 0, "stdout": "…", "files": { "src/math.test.ts": "…formatted…" } }
```

Without that field the formatter step cannot rewrite the file, and the format
check catches the difference instead.

`exitCode === 0` → `ok: true, verified: true`. A non-2xx response or an
unreachable runner → `ok: false, verified: false`. The runner should execute in a
throwaway environment with no network and no secrets; EdgeSpec does not sandbox
the code itself.

## Deployment

`wrangler.toml`:

```toml
name = "edge-spec"
main = "dist/worker/index.js"
compatibility_date = "2025-07-18"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "dist/web"
binding = "ASSETS"
not_found_handling = "single-page-application"

[ai]
binding = "AI"

[[workflows]]
name = "test-generation-workflow"
binding = "TEST_GENERATION_WORKFLOW"
class_name = "TestGenerationWorkflow"
```

`bun run build` must run before `wrangler deploy`; Wrangler uploads the bundles,
not the TypeScript sources.

### Secrets

| Secret                  | Required               | Used by                              |
| ----------------------- | ---------------------- | ------------------------------------ |
| `GITHUB_TOKEN`          | For webhook automation | Workflow: scan, commit, PR           |
| `GITHUB_WEBHOOK_SECRET` | Recommended            | `POST /webhook` HMAC verification    |
| `SANDBOX_RUNNER_URL`    | No                     | Validation, interactive and workflow |
| `SANDBOX_API_KEY`       | No                     | Bearer token for the sandbox         |

```bash
bunx wrangler secret put GITHUB_TOKEN
bunx wrangler secret put GITHUB_WEBHOOK_SECRET
bunx wrangler secret put SANDBOX_RUNNER_URL
bunx wrangler secret put SANDBOX_API_KEY
```

The interactive dashboard does **not** use `GITHUB_TOKEN`; it uses the token
from the browser. The deployment token exists for webhook runs and must never be
sent to a workflow as a parameter (Workflow parameters are persisted).

### GitHub token permissions

- Classic token: `repo` for private repositories; `public_repo` is enough for
  public repositories.
- Fine-grained token: **Contents: read and write**, **Pull requests: read and
  write** on the target repositories.
- Read-only browsing can work with no token; pushing and opening PRs cannot.

### Webhook setup

1. Repository **Settings → Webhooks → Add webhook**.
2. Payload URL: `https://<worker>/webhook`.
3. Content type: `application/json`.
4. Secret: the same value as `GITHUB_WEBHOOK_SECRET`.
5. Events: **push** (the handler does not filter event types).
6. Ensure `GITHUB_TOKEN` can write to the repository and Workers AI is bound.

Runs are durable and can be polled at `GET /api/runs/:id` with the `workflowId`
returned by the webhook.

## GitHub Actions

`.github/workflows/ci.yml` runs on every push and pull request:

```text
bun install --frozen-lockfile
bun run check
bun run build
```

No Cloudflare credentials are needed. `.github/workflows/deploy.yml` deploys
`main` (or a manual dispatch) and requires repository secrets:

| Secret                  | Value                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Token that can upload Workers scripts (Workers Scripts: Edit); the deploy includes the AI and Workflow bindings |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id                                                                                           |

Deploy manually:

```bash
bunx wrangler login
bun run deploy
```

## Local development

```bash
bun install
bun run dev:worker     # built Worker + API on :8787
bun run dev            # Vite on :5173, proxies /api to :8787
```

Run both for dashboard development. `bun run dev:worker` serves the last built
assets, so rebuild (`bun run build:web`) after UI changes if you are not using
Vite. The Worker bundle must be rebuilt after `packages/core/src` or `apps/worker/src` changes
(`bun run build:worker`) because Wrangler loads `dist/worker/index.js`.
