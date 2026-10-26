/**
 * Cloudflare Sandbox runner. Speaks the same `/health` and `/run` contract as
 * `packages/sandbox`, so the dashboard only needs this Worker's URL and key.
 * The container image is built and run by Cloudflare Containers.
 */
import { getSandbox } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

import {
  ARTIFACT_CAP,
  ARTIFACT_PATHS,
  MAX_BODY_BYTES,
  OUTPUT_CAP,
  REMOTE_REPO,
  REMOTE_ROOT,
  cloneCommand,
  parseRunRequest,
  remoteCwd,
  type RunRequest,
} from "./contract";

interface Env {
  /** Durable Object namespace from wrangler.toml. */
  Sandbox: Parameters<typeof getSandbox>[0];
  /** Required. Without it the bridge would execute arbitrary code for anyone. */
  SANDBOX_API_KEY?: string;
}

type SandboxClient = ReturnType<typeof getSandbox>;

const CAPABILITIES = ["v1", "v2", "repo", "setup", "server", "env", "coverage"];

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function authorized(request: Request, env: Env): boolean {
  const expected = env.SANDBOX_API_KEY?.trim();
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function timeoutOf(error: unknown): boolean {
  return /timeout|timed out|deadline/i.test(messageOf(error));
}

async function exec(
  sandbox: SandboxClient,
  command: string,
  cwd: string,
  env: Record<string, string>,
  timeout: number,
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  try {
    const result = await sandbox.exec(command, { cwd, env, timeout });
    return {
      exitCode: Number(result.exitCode ?? 1),
      stdout: String(result.stdout ?? "").slice(0, OUTPUT_CAP),
      stderr: String(result.stderr ?? "").slice(0, OUTPUT_CAP),
      timedOut: false,
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: messageOf(error).slice(0, OUTPUT_CAP),
      timedOut: timeoutOf(error),
    };
  }
}

async function readFile(sandbox: SandboxClient, path: string): Promise<string | undefined> {
  try {
    const result = await sandbox.readFile(path);
    return result.success ? result.content : undefined;
  } catch {
    return undefined;
  }
}

async function writeFiles(sandbox: SandboxClient, root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const full = remoteCwd(root, path);
    const directory = full.slice(0, full.lastIndexOf("/"));
    if (directory) await sandbox.mkdir(directory, { recursive: true });
    await sandbox.writeFile(full, content);
  }
}

function portOf(raw: string | undefined): { port: number; path: string } | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
    return { port, path: `${url.pathname || "/"}${url.search}` };
  } catch {
    return undefined;
  }
}

async function run(env: Env, request: RunRequest): Promise<Record<string, unknown>> {
  const sandbox = getSandbox(env.Sandbox, `edge-spec-${crypto.randomUUID().slice(0, 12)}`, {
    sleepAfter: "5m",
  });
  const root = request.repo ? REMOTE_REPO : REMOTE_ROOT;
  const cwd = remoteCwd(root, request.cwd);
  const envVars = { ...request.env, CI: "1" };
  let serverProcess: Awaited<ReturnType<SandboxClient["startProcess"]>> | undefined;

  try {
    await sandbox.mkdir(root, { recursive: true });

    if (request.repo) {
      const cloned = await exec(
        sandbox,
        cloneCommand(request.repo, root),
        REMOTE_ROOT,
        { ...envVars, ...(request.repo.token ? { GIT_TOKEN: request.repo.token } : {}) },
        120_000,
      );
      if (cloned.exitCode !== 0 || cloned.timedOut) {
        return {
          exitCode: cloned.exitCode,
          stdout: cloned.stdout,
          stderr: cloned.stderr,
          environmentError: "setup",
          ...(cloned.timedOut ? { timedOut: true } : {}),
        };
      }
      // A supplied ref decides the checkout; cloneCommand already did it.
      await sandbox.mkdir(cwd, { recursive: true }).catch(() => undefined);
    }

    await writeFiles(sandbox, root, request.files);

    for (const command of request.setup) {
      const result = await exec(sandbox, command, cwd, envVars, 300_000);
      if (result.exitCode !== 0 || result.timedOut) {
        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          environmentError: "setup",
          ...(result.timedOut ? { timedOut: true } : {}),
        };
      }
    }

    if (request.server) {
      try {
        serverProcess = await sandbox.startProcess(request.server.command, {
          cwd,
          env: envVars,
        });
        const ready = portOf(request.server.readyUrl);
        if (ready) {
          await serverProcess.waitForPort(ready.port, {
            path: ready.path,
            status: { min: 200, max: 399 },
            timeout: request.server.timeoutMs ?? 60_000,
          });
        }
      } catch (error) {
        const logs = await serverProcess?.getLogs().catch(() => undefined);
        return {
          exitCode: 1,
          stdout: logs?.stdout ?? "",
          stderr: `${messageOf(error)}\n${logs?.stderr ?? ""}`.slice(0, OUTPUT_CAP),
          environmentError: "server",
        };
      }
    }

    const result = await exec(sandbox, request.command, cwd, envVars, request.timeoutMs ?? 120_000);

    const files: Record<string, string> = {};
    for (const path of Object.keys(request.files)) {
      const content = await readFile(sandbox, remoteCwd(root, path));
      if (content !== undefined) files[path] = content;
    }
    const artifacts: Record<string, string> = {};
    for (const path of ARTIFACT_PATHS) {
      const content = await readFile(sandbox, remoteCwd(root, path));
      if (content !== undefined && content.length <= ARTIFACT_CAP) artifacts[path] = content;
    }

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      files,
      artifacts,
      ...(result.timedOut ? { timedOut: true } : {}),
    };
  } finally {
    await serverProcess?.kill().catch(() => undefined);
    await sandbox.destroy().catch(() => undefined);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const configured = Boolean(env.SANDBOX_API_KEY?.trim());
      return json({
        ok: configured,
        version: "0.1.0",
        capabilities: CAPABILITIES,
        provider: "cloudflare",
        isolation: "container",
        ...(configured ? {} : { error: "SANDBOX_API_KEY is not configured on the bridge." }),
      });
    }

    if (request.method !== "POST" || url.pathname !== "/run") {
      return json({ error: "Not found." }, 404);
    }
    if (!env.SANDBOX_API_KEY?.trim()) {
      return json({ error: "SANDBOX_API_KEY is not configured on the bridge." }, 503);
    }
    if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);

    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "The request exceeds 10 MB." }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "The request body must be JSON." }, 400);
    }

    try {
      const parsed = parseRunRequest(body);
      return json(await run(env, parsed));
    } catch (error) {
      return json({ error: messageOf(error) }, 400);
    }
  },
};
