/**
 * Vercel Sandbox driver. Like E2B, Vercel owns the filesystem: the workspace is
 * uploaded after the clone and only the requested files are downloaded back.
 * `@vercel/sandbox` is an optional peer dependency loaded lazily, so the runner
 * costs nothing when this provider is unused and the Worker never bundles it.
 */
import {
  EnvironmentFailure,
  OUTPUT_CAP,
  portOf,
  rewriteReadyUrl,
  type CommandResult,
  type Driver,
  type DriverContext,
  type ServerHandle,
} from "./driver";
import { downloadArtifacts, relativePath, remotePath, uploadWorkspace } from "./workspace";

const REMOTE_ROOT = "/vercel/edgespec-workspace";
const SERVER_LOG = "/tmp/edgespec-server.log";

interface VercelCommand {
  kill?(): Promise<void>;
}

interface VercelCommandFinished extends VercelCommand {
  exitCode: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}

interface VercelSandbox {
  domain(port: number): string;
  runCommand(params: {
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    detached?: boolean;
    timeoutMs?: number;
  }): Promise<VercelCommandFinished | VercelCommand>;
  readFileToBuffer(file: { path: string; cwd?: string }): Promise<Buffer | null>;
  writeFiles(files: { path: string; content: string | Uint8Array }[]): Promise<void>;
  stop(): Promise<unknown>;
}

export interface VercelModule {
  Sandbox: {
    create(params: Record<string, unknown>): Promise<VercelSandbox>;
  };
}

export interface VercelConfig {
  token?: string;
  teamId?: string;
  projectId?: string;
  /** Vercel image reference; the universal image already ships Bun. */
  image?: string;
  timeoutMs?: number;
}

/** The SDK is optional; a variable specifier keeps it out of static resolution. */
export async function loadVercel(): Promise<VercelModule> {
  const name = "@vercel/sandbox";
  return (await import(name)) as VercelModule;
}

export async function vercelHealth(
  config: VercelConfig,
  load: () => Promise<VercelModule> = loadVercel,
): Promise<{ ok: boolean; version?: string; error?: string }> {
  if (!config.token?.trim() || !config.teamId?.trim() || !config.projectId?.trim()) {
    return {
      ok: false,
      error: "VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID are required on the runner.",
    };
  }
  try {
    await load();
    return { ok: true, version: "sdk" };
  } catch {
    return {
      ok: false,
      error: "The @vercel/sandbox package is not installed. Run `bun add @vercel/sandbox`.",
    };
  }
}

export function createVercelDriver(
  context: DriverContext,
  config: VercelConfig,
  deps: { load?: () => Promise<VercelModule> } = {},
): Driver {
  if (!config.token?.trim() || !config.teamId?.trim() || !config.projectId?.trim()) {
    throw new EnvironmentFailure(
      "setup",
      "VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID are required on the runner.",
    );
  }
  const env = {
    ...context.env,
    HOME: "/vercel",
    TMPDIR: "/tmp",
    PATH: "/vercel/.local/bin:/vercel/.global/npm/bin:/vercel/.global/pnpm/bin:/usr/local/bin:/usr/bin:/bin",
  };
  const cwd = remotePath(REMOTE_ROOT, relativePath(context.root, context.cwd));
  let sandbox: VercelSandbox | undefined;
  let readyUrl = context.readyUrl;

  const exec = async (
    command: string,
    timeoutMs: number | undefined,
    detached = false,
  ): Promise<{ result?: CommandResult; handle?: VercelCommand }> => {
    const active = sandbox;
    if (!active) throw new EnvironmentFailure("setup", "The Vercel sandbox is not started.");
    const commandResult = await active.runCommand({
      cmd: "bash",
      args: ["-lc", command],
      cwd,
      env,
      ...(detached ? { detached: true } : { timeoutMs }),
    });
    if (detached) return { handle: commandResult as VercelCommand };
    const finished = commandResult as VercelCommandFinished;
    const [stdout, stderr] = await Promise.all([finished.stdout(), finished.stderr()]);
    return {
      result: {
        exitCode: Number(finished.exitCode ?? 1),
        stdout: String(stdout ?? "").slice(0, OUTPUT_CAP),
        stderr: String(stderr ?? "").slice(0, OUTPUT_CAP),
        timedOut: false,
      },
    };
  };

  return {
    kind: "vercel",
    isolation: "vm",
    get readyUrl() {
      return readyUrl;
    },
    async start() {
      const { Sandbox } = await (deps.load ?? loadVercel)();
      const port = portOf(context.readyUrl);
      sandbox = await Sandbox.create({
        token: config.token,
        ...(config.teamId ? { teamId: config.teamId } : {}),
        ...(config.projectId ? { projectId: config.projectId } : {}),
        ...(config.image ? { image: config.image } : {}),
        ...(port ? { ports: [port] } : {}),
        timeout: config.timeoutMs ?? 900_000,
        env,
      });
      if (port && context.readyUrl) {
        readyUrl = rewriteReadyUrl(context.readyUrl, sandbox.domain(port));
      }
    },
    async prepare(root) {
      const active = sandbox;
      if (!active) throw new EnvironmentFailure("setup", "The Vercel sandbox is not started.");
      const files: { path: string; content: Buffer }[] = [];
      await uploadWorkspace(root, (relative, content) => {
        files.push({ path: remotePath(REMOTE_ROOT, relative), content });
        return Promise.resolve();
      });
      if (files.length) await active.writeFiles(files);
    },
    async exec(command, options) {
      const { result } = await exec(command, options.timeoutMs);
      if (!result) throw new EnvironmentFailure("setup", "The Vercel command did not finish.");
      return result;
    },
    async startServer(command) {
      const { handle } = await exec(`(${command}) > ${SERVER_LOG} 2>&1`, undefined, true);
      return {
        // ponytail: readiness is the liveness check; the log is read on failure.
        alive: () => true,
        output: async () =>
          (await exec(`cat ${SERVER_LOG} 2>/dev/null || true`, 10_000)).result?.stdout ?? "",
        stop: async () => {
          await handle?.kill?.().catch(() => undefined);
        },
      } satisfies ServerHandle;
    },
    async fetchArtifacts(root, paths) {
      const active = sandbox;
      if (!active) return;
      await downloadArtifacts(root, paths, (relative) =>
        active.readFileToBuffer({ path: remotePath(REMOTE_ROOT, relative) }),
      );
    },
    async close() {
      await sandbox?.stop().catch(() => undefined);
    },
  };
}
