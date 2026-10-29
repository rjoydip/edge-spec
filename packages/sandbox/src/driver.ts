/**
 * Execution drivers. A run always owns a host temp directory; the driver picks
 * where commands run: a bwrap namespace, or a Docker/Podman container that
 * bind-mounts that directory. The container is the Sandcastle bind-mount shape:
 * one container per run, created and removed inside the same request. The host
 * directory stays the source of truth, so file reads never cross the boundary.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Isolation } from "./isolation";

export const OUTPUT_CAP = 1_000_000;
export const CONTAINER_ROOT = "/workspace";
export const DEFAULT_IMAGE = "oven/bun:1";
const SERVER_LOG = "/tmp/edgespec-server.log";

export type DriverKind = "bwrap" | "docker" | "podman" | "e2b" | "vercel" | "daytona" | "none";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** An environment failure is never a failed test result. */
export class EnvironmentFailure extends Error {
  constructor(
    readonly kind: "setup" | "server" | "timeout",
    message: string,
  ) {
    super(message);
  }
}

export interface DriverContext {
  /** Host workspace root; the container mounts it at CONTAINER_ROOT. */
  root: string;
  /** Directory the commands run in, inside the workspace. */
  cwd: string;
  env: Record<string, string>;
  readyUrl?: string;
}

export interface ServerHandle {
  alive(): boolean;
  output(): Promise<string>;
  stop(): Promise<void>;
}

export interface Driver {
  kind: DriverKind;
  isolation: "namespace" | "container" | "vm" | "none";
  /** The readiness URL, rewritten to the published host port for containers. */
  readonly readyUrl?: string;
  start(): Promise<void>;
  /** Isolated drivers upload the host workspace before the first command. */
  prepare?(root: string): Promise<void>;
  /** Isolated drivers download the requested files into the host workspace. */
  fetchArtifacts?(root: string, paths: string[]): Promise<void>;
  exec(command: string, options: { timeoutMs: number }): Promise<CommandResult>;
  startServer(command: string): Promise<ServerHandle>;
  close(): Promise<void>;
}

async function readCapped(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (text.length >= OUTPUT_CAP) {
        await reader.cancel();
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // A killed process can break the pipe; the partial output is still useful.
  }
  return text.slice(0, OUTPUT_CAP);
}

/** Spawns one process to completion, capping output and enforcing a timeout. */
export async function spawnCapture(
  argv: string[],
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
    timeoutMs: number;
  },
): Promise<CommandResult> {
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      proc.kill("SIGKILL");
    },
    Math.max(1, options.timeoutMs),
  );
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readCapped(proc.stdout),
      readCapped(proc.stderr),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

function shell(command: string): string[] {
  return ["bash", "-lc", command];
}

/**
 * A namespace driver: bwrap when isolation exists, plain host otherwise. The
 * host fallback is only reachable through SANDBOX_ALLOW_UNISOLATED=1.
 */
function namespaceDriver(
  context: DriverContext,
  kind: "bwrap" | "none",
  wrap: Isolation["wrap"],
): Driver {
  return {
    kind,
    isolation: kind === "bwrap" ? "namespace" : "none",
    readyUrl: context.readyUrl,
    async start() {
      // The wrapper is applied per command; there is nothing to boot.
    },
    exec(command, options) {
      return spawnCapture(wrap(shell(command), { workdir: context.cwd, env: context.env }), {
        cwd: context.cwd,
        env: context.env,
        timeoutMs: options.timeoutMs,
      });
    },
    async startServer(command) {
      const proc = Bun.spawn(wrap(shell(command), { workdir: context.cwd, env: context.env }), {
        cwd: context.cwd,
        env: context.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = readCapped(proc.stderr);
      void readCapped(proc.stdout);
      return {
        alive: () => proc.exitCode === null,
        output: () => output,
        stop: async () => {
          proc.kill("SIGKILL");
        },
      };
    },
    async close() {
      // Nothing to tear down.
    },
  };
}

export function bwrapDriver(context: DriverContext, isolation: Isolation): Driver {
  return namespaceDriver(context, isolation.kind, isolation.wrap);
}

export function hostDriver(context: DriverContext): Driver {
  return namespaceDriver(context, "none", (argv) => argv);
}

/** Path inside the container for a directory inside the workspace root. */
export function containerCwd(root: string, cwd: string): string {
  const relative = path.relative(root, cwd).replace(/\\/g, "/");
  if (!relative || relative === ".") return CONTAINER_ROOT;
  if (relative.startsWith("..")) throw new Error(`The working directory escapes ${root}.`);
  return `${CONTAINER_ROOT}/${relative}`;
}

/** The port a readiness URL asks for, if it names one. */
export function portOf(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return Number(url.port) || (url.protocol === "https:" ? 443 : 80);
  } catch {
    return undefined;
  }
}

/**
 * Points a readiness URL at the provider's public host. The path stays the
 * app's path; a signed URL's query token is kept alongside any query the app
 * already had.
 */
export function rewriteReadyUrl(original: string, publicUrl: string): string {
  const target = new URL(original);
  const host = new URL(publicUrl);
  target.protocol = host.protocol;
  target.hostname = host.hostname;
  target.port = host.port;
  const extra = host.search.replace(/^\?/, "");
  if (extra) {
    target.search = target.search ? `?${target.search.slice(1)}&${extra}` : host.search;
  }
  return target.toString();
}

export function containerStartArgs(input: {
  kind: "docker" | "podman";
  image: string;
  root: string;
  name: string;
  readyUrl?: string;
  user?: string;
}): string[] {
  const args = [
    input.kind,
    "run",
    "-d",
    "--name",
    input.name,
    "-v",
    `${input.root}:${CONTAINER_ROOT}`,
    "-w",
    CONTAINER_ROOT,
  ];
  if (input.user) args.push("--user", input.user);
  // SELinux hosts refuse an unlabelled bind mount; the mount is a temp dir.
  if (input.kind === "podman") args.push("--security-opt", "label=disable");
  const port = portOf(input.readyUrl);
  // An ephemeral host port: several runs can boot the same app port at once.
  if (port) args.push("-p", `127.0.0.1::${port}`);
  args.push(input.image, "sleep", "infinity");
  return args;
}

export function containerExecArgs(input: {
  kind: "docker" | "podman";
  name: string;
  cwd: string;
  env: Record<string, string>;
  command: string;
  detached?: boolean;
}): string[] {
  const args = [input.kind, "exec"];
  if (input.detached) args.push("-d");
  args.push("-w", input.cwd);
  for (const [key, value] of Object.entries(input.env)) args.push("--env", `${key}=${value}`);
  args.push(input.name, "bash", "-lc", input.command);
  return args;
}

/** Reads the host port from `<kind> port <name> <containerPort>` output. */
export function parsePublishedPort(output: string): number | undefined {
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^\S+:(\d+)$/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

export function containerDriver(
  kind: "docker" | "podman",
  context: DriverContext,
  options: { image?: string } = {},
): Driver {
  const name = `edgespec-${crypto.randomUUID().slice(0, 8)}`;
  const image = options.image || DEFAULT_IMAGE;
  const user =
    process.platform === "linux" && typeof process.getuid === "function"
      ? `${process.getuid()}:${process.getgid?.() ?? 0}`
      : undefined;
  const cwd = containerCwd(context.root, context.cwd);
  const env = {
    ...context.env,
    // The host paths from baseEnv do not exist inside the container.
    HOME: `${CONTAINER_ROOT}/.edgespec-home`,
    TMPDIR: "/tmp",
  };
  let readyUrl = context.readyUrl;
  const cli = (args: string[], timeoutMs: number) =>
    spawnCapture(args, { cwd: context.root, env: process.env, timeoutMs });
  const execArgs = (command: string, detached?: boolean) =>
    containerExecArgs({ kind, name, cwd, env, command, detached });

  return {
    kind,
    isolation: "container",
    get readyUrl() {
      return readyUrl;
    },
    async start() {
      await mkdir(path.join(context.root, ".edgespec-home"), {
        recursive: true,
      });
      const started = await cli(
        containerStartArgs({
          kind,
          image,
          root: context.root,
          name,
          readyUrl,
          user,
        }),
        300_000,
      );
      if (started.timedOut || started.exitCode !== 0) {
        throw new EnvironmentFailure(
          "setup",
          `${kind} could not start ${image}: ${(started.stderr || started.stdout).slice(0, 2000)}`,
        );
      }
      const port = portOf(context.readyUrl);
      if (!port || !readyUrl) return;
      const published = await cli([kind, "port", name, String(port)], 10_000);
      const hostPort = parsePublishedPort(published.stdout);
      if (!hostPort) return;
      const url = new URL(readyUrl);
      url.hostname = "127.0.0.1";
      url.port = String(hostPort);
      readyUrl = url.toString();
    },
    exec(command, options) {
      return cli(execArgs(command), options.timeoutMs);
    },
    async startServer(command) {
      const started = await cli(execArgs(`(${command}) > ${SERVER_LOG} 2>&1`, true), 30_000);
      if (started.timedOut || started.exitCode !== 0) {
        throw new EnvironmentFailure(
          "server",
          `${kind} could not start the app: ${(started.stderr || started.stdout).slice(0, 2000)}`,
        );
      }
      return {
        // ponytail: readiness is the liveness check; a crashed app is reported
        // after the readiness timeout together with its log.
        alive: () => true,
        output: async () => {
          const read = await cli(execArgs(`cat ${SERVER_LOG} 2>/dev/null || true`), 10_000);
          return read.stdout;
        },
        stop: async () => {
          // Removing the container in close() kills the app too.
        },
      };
    },
    async close() {
      // Container removal kills the app and anything the commands left behind.
      await cli([kind, "rm", "-f", name], 60_000).catch(() => undefined);
    },
  };
}

/**
 * The caller's `x-sandbox-provider` assertion. `auto`, `custom`, an absent
 * header and an unknown id assert nothing.
 */
export function providerMismatch(
  expected: string | null | undefined,
  kind: DriverKind,
): string | undefined {
  const wanted = expected?.trim().toLowerCase();
  if (!wanted || wanted === "auto" || wanted === "custom") return undefined;
  if (!["bwrap", "docker", "podman", "e2b", "vercel", "daytona"].includes(wanted)) return undefined;
  return wanted === kind ? undefined : `This runner uses ${kind}, not ${wanted}.`;
}

/** Chooses the driver. `auto` prefers bwrap, then Docker, then Podman. */ export function detectDriverKind(
  requested: string,
  isolation: Isolation,
  has: (binary: string) => boolean = (binary) => Boolean(Bun.which(binary)),
): DriverKind {
  if (requested === "bwrap" || requested === "docker" || requested === "podman") {
    return requested;
  }
  if (requested === "e2b" || requested === "vercel" || requested === "daytona") return requested;
  if (requested !== "auto") return "none";
  if (isolation.kind === "bwrap") return "bwrap";
  if (has("docker")) return "docker";
  if (has("podman")) return "podman";
  return "none";
}

/** Startup check for the runner's `/health`: is the driver actually usable? */
export async function driverHealth(
  kind: Exclude<DriverKind, "e2b" | "vercel" | "daytona">,
): Promise<{ ok: boolean; version?: string; error?: string }> {
  if (kind === "none") {
    return { ok: false, error: "No sandbox driver is available." };
  }
  if (kind === "bwrap") return { ok: true };
  const result = await spawnCapture([kind, "version", "--format", "{{.Server.Version}}"], {
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 5_000,
  }).catch((error: unknown) => ({
    exitCode: 1,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
    timedOut: false,
  }));
  if (result.exitCode === 0) {
    return {
      ok: true,
      ...(result.stdout.trim() ? { version: result.stdout.trim() } : {}),
    };
  }
  return {
    ok: false,
    error: `${kind} is not running: ${(result.stderr || result.stdout).trim().slice(0, 500)}`,
  };
}
