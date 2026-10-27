/**
 * One sandbox run: a fresh temp directory, an optional clone with files written
 * on top, sequential setup, an optional booted server, then the test command.
 * A driver decides where the commands execute; file I/O always stays on the
 * host workspace, which the container drivers bind-mount.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SandboxReply, SandboxRequest } from "@edge-spec/core/sandbox";
import {
  EnvironmentFailure,
  OUTPUT_CAP,
  spawnCapture,
  type Driver,
  type DriverContext,
  type ServerHandle,
} from "./driver";
import { relativePath } from "./workspace";

const FILE_TOTAL_CAP = 10_000_000;
const ARTIFACTS = ["coverage/lcov.info", "junit.xml", "recorded-fixtures.json"];
const BASE_PATH = "/usr/local/bin:/usr/bin:/bin";

export interface WorkspaceResult extends SandboxReply {
  files: Record<string, string>;
  artifacts: Record<string, string>;
}

/** Resolves a request path inside the workspace or refuses it. */
export function safePath(root: string, relative: string): string {
  if (typeof relative !== "string" || !relative.trim()) {
    throw new Error("A path in the request is empty.");
  }
  const cleaned = relative.replace(/\\/g, "/");
  if (cleaned.startsWith("/") || /^[A-Za-z]:/.test(cleaned)) {
    throw new Error(`Absolute path refused: ${relative}`);
  }
  const normalized = path.posix.normalize(cleaned);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path escapes the workspace: ${relative}`);
  }
  return path.join(root, normalized);
}

function baseEnv(home: string, extra: Record<string, string> | undefined): Record<string, string> {
  return {
    PATH: BASE_PATH,
    HOME: home,
    TMPDIR: home,
    LANG: "C.UTF-8",
    ...extra,
  };
}

function withToken(url: string, token: string): string {
  const parsed = new URL(url);
  parsed.username = "x-access-token";
  parsed.password = token;
  return parsed.toString();
}

async function cloneRepo(input: {
  repo: NonNullable<SandboxRequest["repo"]>;
  cwd: string;
  env: Record<string, string>;
}): Promise<void> {
  let url: URL;
  try {
    url = new URL(input.repo.url);
  } catch {
    throw new EnvironmentFailure("setup", `Invalid repository URL: ${input.repo.url}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new EnvironmentFailure("setup", "Only http(s) repository URLs can be cloned.");
  }
  // The clone runs on the host: it needs network before the sandbox exists.
  // Files are written on top afterwards, so the token never enters the sandbox.
  const cloneUrl = input.repo.token ? withToken(input.repo.url, input.repo.token) : input.repo.url;
  const result = await spawnCapture(
    [
      "git",
      "clone",
      "--depth",
      "1",
      ...(input.repo.ref ? ["--branch", input.repo.ref] : []),
      cloneUrl,
      ".",
    ],
    {
      cwd: input.cwd,
      env: { ...input.env, GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: 180_000,
    },
  );
  if (result.timedOut) throw new EnvironmentFailure("setup", "git clone timed out.");
  if (result.exitCode !== 0) {
    throw new EnvironmentFailure(
      "setup",
      `git clone failed: ${(result.stderr || result.stdout).slice(0, 2000)}`,
    );
  }
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  let total = 0;
  for (const [relative, content] of Object.entries(files)) {
    if (typeof content !== "string") throw new Error(`File ${relative} is not text.`);
    total += content.length;
    if (total > FILE_TOTAL_CAP) throw new Error("The request files exceed 10 MB.");
    const target = safePath(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

async function waitForReady(input: {
  url: string;
  timeoutMs: number;
  server: ServerHandle;
}): Promise<boolean> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    if (!input.server.alive()) return false;
    try {
      const response = await fetch(input.url, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 400) return true;
    } catch {
      // Not up yet.
    }
    await Bun.sleep(250);
  }
  return false;
}

async function collectFiles(
  root: string,
  requested: Record<string, string>,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const relative of Object.keys(requested)) {
    try {
      const target = safePath(root, relative);
      const info = await stat(target);
      if (!info.isFile() || info.size > OUTPUT_CAP) continue;
      result[relative] = await readFile(target, "utf8");
    } catch {
      // The command may have deleted it; that is not an error.
    }
  }
  return result;
}

async function collectArtifacts(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const relative of ARTIFACTS) {
    try {
      const info = await stat(path.join(root, relative));
      if (!info.isFile() || info.size > 5_000_000) continue;
      result[relative] = await readFile(path.join(root, relative), "utf8");
    } catch {
      // Not every command produces every artifact.
    }
  }
  return result;
}

export async function runInWorkspace(
  request: SandboxRequest,
  options: { createDriver: (context: DriverContext) => Driver },
): Promise<WorkspaceResult> {
  if (!request || typeof request.command !== "string" || !request.command.trim()) {
    throw new Error("A command is required.");
  }
  const root = await mkdtemp(path.join(tmpdir(), "edgespec-sandbox-"));
  const timeoutMs = Math.min(600_000, Math.max(10_000, Number(request.timeoutMs) || 180_000));
  let driver: Driver | undefined;
  let server: ServerHandle | undefined;

  try {
    const cwd = safePath(root, request.cwd ?? ".");
    await mkdir(cwd, { recursive: true });
    const env = baseEnv(cwd, request.env);

    if (request.repo) await cloneRepo({ repo: request.repo, cwd, env });
    if (request.files) await writeFiles(cwd, request.files);

    driver = options.createDriver({
      root,
      cwd,
      env,
      readyUrl: request.server?.readyUrl,
    });
    await driver.start();
    await driver.prepare?.(root);

    for (const command of request.setup ?? []) {
      const result = await driver.exec(command, { timeoutMs });
      if (result.timedOut) {
        throw new EnvironmentFailure("timeout", `Setup timed out: ${command}`);
      }
      if (result.exitCode !== 0) {
        throw new EnvironmentFailure(
          "setup",
          `Setup failed (${command}): ${(result.stderr || result.stdout).slice(0, 2000)}`,
        );
      }
    }

    if (request.server?.command) {
      server = await driver.startServer(request.server.command);
      const readyUrl = driver.readyUrl ?? request.server.readyUrl;
      if (readyUrl) {
        const ready = await waitForReady({
          url: readyUrl,
          timeoutMs: Math.min(timeoutMs, request.server.timeoutMs ?? 60_000),
          server,
        });
        if (!ready) {
          const stderr = await server.output();
          throw new EnvironmentFailure(
            "server",
            `The app did not answer ${readyUrl}: ${stderr.slice(0, 2000)}`,
          );
        }
      }
    }

    const result = await driver.exec(request.command, { timeoutMs });
    // The hooks speak workspace-relative paths; the request paths are cwd-relative.
    const requested = [...(request.files ? Object.keys(request.files) : []), ...ARTIFACTS];
    await driver.fetchArtifacts?.(
      root,
      requested.map((relative) => relativePath(root, path.join(cwd, relative))),
    );
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.timedOut ? { timedOut: true } : {}),
      files: request.files ? await collectFiles(cwd, request.files) : {},
      artifacts: await collectArtifacts(cwd),
    };
  } catch (error) {
    if (error instanceof EnvironmentFailure) {
      return {
        exitCode: 1,
        stderr: error.message,
        ...(error.kind === "timeout" ? { timedOut: true } : {}),
        environmentError: error.kind,
        files: {},
        artifacts: {},
      };
    }
    throw error;
  } finally {
    await server?.stop().catch(() => undefined);
    await driver?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}
