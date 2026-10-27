# EdgeSpec sandbox

The reference self-hosted runner for the EdgeSpec sandbox contract. It is a
plain Bun HTTP service: no Dockerfile, no image build.

```bash
bun test packages/sandbox
bun run --filter @edge-spec/sandbox typecheck
bun run sandbox                        # 127.0.0.1:8788, auto-detect
SANDBOX_PROVIDER=docker bun run sandbox
SANDBOX_PROVIDER=podman SANDBOX_IMAGE=node:22 bun run sandbox
bun add e2b --cwd packages/sandbox
SANDBOX_PROVIDER=e2b E2B_API_KEY=... bun run sandbox
bun add @vercel/sandbox --cwd packages/sandbox
SANDBOX_PROVIDER=vercel VERCEL_TOKEN=... VERCEL_TEAM_ID=... VERCEL_PROJECT_ID=... bun run sandbox
bun add @daytona/sdk --cwd packages/sandbox
SANDBOX_PROVIDER=daytona DAYTONA_API_KEY=... bun run sandbox
```

An isolation boundary is required; `/run` returns `503` without one.
`auto` prefers `bwrap` (Linux/WSL2), then Docker, then Podman. Hosted providers
(`e2b`, `vercel`, `daytona`) are opt-in and need their key in the runner's
environment. Containers pull an existing image and bind-mount the run's temp
directory; hosted providers upload the workspace into a microVM and download
the requested files afterwards. No Dockerfile is added. A hosted template or
image must include `git` and the runtime the repository needs, or `setup` fails
as an environment error.

`SANDBOX_ALLOW_UNISOLATED=1` is a development escape hatch and must never be
used on a shared host.

## Configuration

| Variable                     | Meaning                                                                             |
| :--------------------------- | :---------------------------------------------------------------------------------- |
| `SANDBOX_HOST`               | Bind address, default `127.0.0.1`. A non-loopback bind requires a key.              |
| `SANDBOX_PORT`               | Port, default `8788`.                                                               |
| `SANDBOX_API_KEY`            | Required as `Authorization: Bearer <key>` when set.                                 |
| `SANDBOX_PROVIDER`           | `auto` (default), `bwrap`, `docker`, `podman`, `e2b`, `vercel` or `daytona`.        |
| `SANDBOX_IMAGE`              | Container image to pull, default `oven/bun:1`.                                      |
| `E2B_API_KEY`                | Required for `SANDBOX_PROVIDER=e2b`; stays on the runner.                           |
| `E2B_TEMPLATE`               | E2B template name, default is the SDK's.                                            |
| `E2B_TIMEOUT_MS`             | Sandbox lifetime, default 10 minutes.                                               |
| `VERCEL_TOKEN`               | Required for `SANDBOX_PROVIDER=vercel`; scoped to the team.                         |
| `VERCEL_TEAM_ID`             | Vercel team that owns the sandbox project.                                          |
| `VERCEL_PROJECT_ID`          | Vercel project that owns the sandbox.                                               |
| `VERCEL_SANDBOX_IMAGE`       | Optional image; the universal image already ships Bun.                              |
| `VERCEL_SANDBOX_TIMEOUT_MS`  | Sandbox lifetime, default 15 minutes.                                               |
| `DAYTONA_API_KEY`            | Required for `SANDBOX_PROVIDER=daytona`.                                            |
| `DAYTONA_API_URL`            | Optional Daytona API URL, for a self-hosted control plane.                          |
| `DAYTONA_TARGET`             | Optional Daytona region.                                                            |
| `DAYTONA_SNAPSHOT`           | Snapshot that contains Bun; the default snapshot may not.                           |
| `DAYTONA_IMAGE`              | Optional image; Daytona builds a snapshot from it on first use.                     |
| `DAYTONA_TIMEOUT_MS`         | Sandbox lifetime, default 15 minutes.                                               |
| `SANDBOX_ALLOW_EGRESS=1`     | Give the `bwrap` child network access. Off by default; `setup` needs it to install. |
| `SANDBOX_ALLOW_UNISOLATED=1` | Run without an isolation boundary. Development only.                                |

Put TLS and authentication in a reverse proxy; the runner only speaks HTTP.

## Contract

`GET /health` → `{ ok, version, capabilities, provider, isolation }`.
`isolation` is `namespace` (bwrap), `container` (Docker/Podman), `vm`
(E2B/Vercel/Daytona) or `none`.
Containers are checked with `<kind> version`, so a stopped daemon reports
`ok: false` and `/run` answers `503`. Hosted providers report `ok: false` when
their key or SDK is missing.

`/health` and `/run` also accept
`x-sandbox-provider: bwrap|docker|podman|e2b|vercel|daytona` as an assertion: a
mismatch answers `ok: false` / `409` instead of running the suite on another
driver. The dashboard sends it when a runner driver is picked.

`POST /run` accepts the EdgeSpec v2 request (see `packages/core/src/sandbox.ts`):

```jsonc
{
  "v": 2,
  "repo": { "url": "https://github.com/acme/api.git", "ref": "main" },
  "files": { "src/math.test.ts": "…" },
  "cwd": "packages/api",
  "setup": ["bun install --frozen-lockfile"],
  "env": { "NODE_ENV": "test" },
  "server": {
    "command": "bun run dev",
    "readyUrl": "http://127.0.0.1:3000/health",
  },
  "command": "bun test",
  "timeoutMs": 180000,
}
```

It replies with `exitCode`, `stdout`, `stderr`, `timedOut`, the request `files`
read back (so a formatter can return its output), and `artifacts`
(`coverage/lcov.info`, `junit.xml`) when present. A clone or setup failure is
`environmentError: "setup"`; an app that never answers is `"server"`. A v1 body
`{files, command}` still works.

`custom-runner.example.ts` is the smallest runner that speaks this contract
(Docker as the boundary). Use it as the template for a runner of your
own: `bun packages/sandbox/custom-runner.example.ts`, then pick **Custom runner**.
It reads `RUNNER_IMAGE`, `RUNNER_DOCKER` and `RUNNER_PORT` (default `8899`) and
implements only `/health` and `/run` — no `setup`, `server` or `repo`.

## Security notes

- One fresh temp directory per request, removed in a `finally`.
- `bwrap`: `--unshare-all`, `--new-session`, `--die-with-parent`, read-only
  runtime binds, empty environment; only the workdir is writable.
- Docker/Podman: one container per run, bind-mounting only that temp directory,
  removed in the same request. The app port is published on loopback with an
  ephemeral host port. The container keeps its own network (setup needs it).
- E2B: the workspace is uploaded into a microVM (build output and
  `node_modules` skipped) and only the requested files are downloaded back. The
  key lives in the runner's environment and never travels in the run body.
- Vercel Sandbox and Daytona: same copy-in/copy-out over their SDKs. Their
  tokens stay on the runner. Daytona's readiness URL is a signed preview URL,
  so the app is not made public; Vercel publishes only the declared app port.
- Absolute paths and `..` in `files`/`cwd` are refused. Requests over 10 MB and
  output over 1 MB are refused or truncated.
- The clone runs on the host into the fresh workdir, before any command runs
  there; an optional repository token is used only for that clone.
- No host secrets are inherited; only the request's `env` is passed through.
  Container runs add a writable `HOME` inside the workspace.
- The `bwrap` network namespace is empty unless `SANDBOX_ALLOW_EGRESS=1`.
- The `server` process is killed when the run ends, on success or failure;
  a container run is removed with `rm -f`.

[bwrap]: https://github.com/containers/bubblewrap
