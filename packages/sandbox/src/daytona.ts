/**
 * Daytona driver. A Daytona sandbox owns its filesystem, so the workspace is
 * uploaded after the clone and only the requested files are downloaded back.
 * `@daytona/sdk` is an optional peer dependency loaded lazily.
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

const REMOTE_ROOT = "edgespec-workspace";
const SERVER_LOG = "/tmp/edgespec-server.log";

interface DaytonaSandbox {
  process: {
    executeCommand(
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeoutSeconds?: number,
    ): Promise<{ exitCode: number; result: string }>;
  };
  fs: {
    uploadFile(file: Buffer, remotePath: string): Promise<void>;
    downloadFile(remotePath: string, localPath: string): Promise<void>;
  };
  getSignedPreviewUrl(port: number, expiresInSeconds?: number): Promise<{ url: string }>;
  delete(): Promise<void>;
}

interface DaytonaClient {
  create(params?: Record<string, unknown>, options?: { timeout?: number }): Promise<DaytonaSandbox>;
}

export interface DaytonaModule {
  Daytona: new (options?: Record<string, unknown>) => DaytonaClient;
}

export interface DaytonaConfig {
  apiKey?: string;
  apiUrl?: string;
  target?: string;
  /** A snapshot that already contains Bun; the default snapshot may not. */
  snapshot?: string;
  /** Image reference; Daytona builds a snapshot from it on first use. */
  image?: string;
  timeoutMs?: number;
}

/** The SDK is optional; a variable specifier keeps it out of static resolution. */
export async function loadDaytona(): Promise<DaytonaModule> {
  const name = "@daytona/sdk";
  return (await import(name)) as DaytonaModule;
}

export async function daytonaHealth(
  config: DaytonaConfig,
  load: () => Promise<DaytonaModule> = loadDaytona,
): Promise<{ ok: boolean; version?: string; error?: string }> {
  if (!config.apiKey?.trim()) {
    return { ok: false, error: "DAYTONA_API_KEY is not set on the runner." };
  }
  try {
    await load();
    return { ok: true, version: "sdk" };
  } catch {
    return {
      ok: false,
      error: "The @daytona/sdk package is not installed. Run `bun add @daytona/sdk`.",
    };
  }
}

export function createDaytonaDriver(
  context: DriverContext,
  config: DaytonaConfig,
  deps: { load?: () => Promise<DaytonaModule> } = {},
): Driver {
  if (!config.apiKey?.trim()) {
    throw new EnvironmentFailure("setup", "DAYTONA_API_KEY is not set on the runner.");
  }
  const { HOME: _home, TMPDIR: _tmp, PATH: _path, ...inherited } = context.env;
  const env = { ...inherited, TMPDIR: "/tmp" };
  const cwd = remotePath(REMOTE_ROOT, relativePath(context.root, context.cwd));
  const lifetimeMs = config.timeoutMs ?? 900_000;
  let sandbox: DaytonaSandbox | undefined;
  let readyUrl = context.readyUrl;

  const exec = async (command: string, timeoutMs: number): Promise<CommandResult> => {
    const active = sandbox;
    if (!active) throw new EnvironmentFailure("setup", "The Daytona sandbox is not started.");
    const result = await active.process.executeCommand(
      command,
      cwd,
      env,
      Math.max(1, Math.ceil(timeoutMs / 1000)),
    );
    return {
      exitCode: Number(result.exitCode ?? 1),
      stdout: String(result.result ?? "").slice(0, OUTPUT_CAP),
      // executeCommand returns stdout only; stderr is part of the result.
      stderr: "",
      timedOut: false,
    };
  };

  return {
    kind: "daytona",
    isolation: "vm",
    get readyUrl() {
      return readyUrl;
    },
    async start() {
      const { Daytona } = await (deps.load ?? loadDaytona)();
      const client = new Daytona({
        apiKey: config.apiKey,
        ...(config.apiUrl ? { apiUrl: config.apiUrl } : {}),
        ...(config.target ? { target: config.target } : {}),
      });
      sandbox = await client.create(
        {
          ...(config.snapshot ? { snapshot: config.snapshot } : {}),
          ...(config.image ? { image: config.image } : {}),
          envVars: env,
          ephemeral: true,
          autoStopInterval: Math.max(1, Math.ceil(lifetimeMs / 60_000)),
        },
        { timeout: 120 },
      );
      const port = portOf(context.readyUrl);
      if (port && context.readyUrl) {
        const signed = await sandbox.getSignedPreviewUrl(port, 3600);
        readyUrl = rewriteReadyUrl(context.readyUrl, signed.url);
      }
    },
    async prepare(root) {
      const active = sandbox;
      if (!active) throw new EnvironmentFailure("setup", "The Daytona sandbox is not started.");
      await uploadWorkspace(root, (relative, content) =>
        active.fs.uploadFile(content, remotePath(REMOTE_ROOT, relative)),
      );
    },
    async exec(command, options) {
      return exec(command, options.timeoutMs);
    },
    async startServer(command) {
      await exec(`(${command}) > ${SERVER_LOG} 2>&1 &`, 30_000);
      return {
        // ponytail: readiness is the liveness check; the log is read on failure.
        alive: () => true,
        output: async () => (await exec(`cat ${SERVER_LOG} 2>/dev/null || true`, 10_000)).stdout,
        stop: async () => {
          // Deleting the sandbox in close() kills the app too.
        },
      } satisfies ServerHandle;
    },
    async fetchArtifacts(root, paths) {
      const active = sandbox;
      if (!active) return;
      await downloadArtifacts(root, paths, async (relative, local) => {
        await active.fs.downloadFile(remotePath(REMOTE_ROOT, relative), local);
      });
    },
    async close() {
      await sandbox?.delete().catch(() => undefined);
    },
  };
}
