/**
 * E2B driver. E2B sandboxes own their filesystem, so the driver uploads the
 * host workspace after the clone and downloads only the files the run asks for.
 * The SDK is an optional peer dependency of the runner and is imported lazily,
 * like Sandcastle does: no `e2b` in the Worker bundle, no cost when unused.
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

const REMOTE_ROOT = "/home/user/workspace";
const SERVER_LOG = "/tmp/edgespec-server.log";

interface E2bCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface E2bCommandHandle {
  kill?: () => Promise<void>;
}

interface E2bSandbox {
  sandboxId: string;
  commands: {
    run(
      command: string,
      options?: {
        cwd?: string;
        envs?: Record<string, string>;
        timeoutMs?: number;
        background?: boolean;
      },
    ): Promise<E2bCommandResult & E2bCommandHandle>;
  };
  files: {
    write(path: string, content: string | Uint8Array): Promise<unknown>;
    read(path: string): Promise<string>;
  };
  getHost(port: number): string;
  kill(): Promise<void>;
}

export interface E2bModule {
  Sandbox: {
    create(
      template?: string,
      options?: { apiKey?: string; timeoutMs?: number },
    ): Promise<E2bSandbox>;
  };
}

export interface E2bConfig {
  apiKey?: string;
  template?: string;
  /** Per-sandbox lifetime cap; the run's own timeout is usually shorter. */
  timeoutMs?: number;
}

/** The SDK is optional; a variable specifier keeps it out of static resolution. */
export async function loadE2b(): Promise<E2bModule> {
  const name = "e2b";
  return (await import(name)) as E2bModule;
}

export async function e2bHealth(
  config: E2bConfig,
  load: () => Promise<E2bModule> = loadE2b,
): Promise<{ ok: boolean; version?: string; error?: string }> {
  if (!config.apiKey?.trim()) {
    return { ok: false, error: "E2B_API_KEY is not set on the runner." };
  }
  try {
    await load();
    return { ok: true, version: "sdk" };
  } catch {
    return {
      ok: false,
      error: "The e2b package is not installed in the runner. Run `bun add e2b`.",
    };
  }
}

export function createE2bDriver(
  context: DriverContext,
  config: E2bConfig,
  deps: { load?: () => Promise<E2bModule> } = {},
): Driver {
  if (!config.apiKey?.trim()) {
    throw new EnvironmentFailure("setup", "E2B_API_KEY is not set on the runner.");
  }
  const env = {
    ...context.env,
    HOME: "/home/user",
    TMPDIR: "/tmp",
    PATH: "/usr/local/bin:/usr/bin:/bin",
  };
  const cwd = remotePath(REMOTE_ROOT, relativePath(context.root, context.cwd));
  let sandbox: E2bSandbox | undefined;
  let readyUrl = context.readyUrl;

  const exec = async (command: string, timeoutMs: number | undefined, background = false) => {
    if (!sandbox) throw new EnvironmentFailure("setup", "The E2B sandbox is not started.");
    const result = await sandbox.commands.run(command, {
      cwd,
      envs: env,
      ...(background ? { background: true } : { timeoutMs }),
    });
    const mapped: CommandResult = {
      exitCode: Number(result.exitCode ?? 1),
      stdout: String(result.stdout ?? "").slice(0, OUTPUT_CAP),
      stderr: String(result.stderr ?? "").slice(0, OUTPUT_CAP),
      timedOut: false,
    };
    return { result: mapped, handle: result as E2bCommandHandle };
  };

  return {
    kind: "e2b",
    isolation: "vm",
    get readyUrl() {
      return readyUrl;
    },
    async start() {
      const { Sandbox } = await (deps.load ?? loadE2b)();
      sandbox = await Sandbox.create(config.template, {
        apiKey: config.apiKey,
        ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
      });
      const port = portOf(context.readyUrl);
      if (port && context.readyUrl) {
        readyUrl = rewriteReadyUrl(context.readyUrl, `https://${sandbox.getHost(port)}`);
      }
    },
    async prepare(root) {
      const active = sandbox;
      if (!active) throw new EnvironmentFailure("setup", "The E2B sandbox is not started.");
      await uploadWorkspace(root, (relative, content) =>
        active.files.write(remotePath(REMOTE_ROOT, relative), content),
      );
    },
    async exec(command, options) {
      return (await exec(command, options.timeoutMs)).result;
    },
    async startServer(command) {
      const { handle } = await exec(`(${command}) > ${SERVER_LOG} 2>&1`, undefined, true);
      return {
        // ponytail: readiness is the liveness check; the log is read on failure.
        alive: () => true,
        output: async () =>
          (await exec(`cat ${SERVER_LOG} 2>/dev/null || true`, 10_000)).result.stdout,
        stop: async () => {
          await handle.kill?.().catch(() => undefined);
        },
      } satisfies ServerHandle;
    },
    async fetchArtifacts(root, paths) {
      const active = sandbox;
      if (!active) return;
      await downloadArtifacts(root, paths, (relative) =>
        active.files.read(remotePath(REMOTE_ROOT, relative)),
      );
    },
    async close() {
      await sandbox?.kill().catch(() => undefined);
    },
  };
}
