/**
 * A minimal custom runner: two routes, Docker as the boundary, no image build.
 * It is the smallest thing that speaks the EdgeSpec sandbox contract, so it is
 * also the template for wrapping a queue, a CI job or a hosted API.
 *
 *   docker pull oven/bun:1
 *   bun packages/sandbox/custom-runner.example.ts
 *
 * Then pick "Custom runner" in Settings with `http://127.0.0.1:8899`.
 * `setup`, `server` and `repo` are not implemented, so `/health` does not
 * advertise them and EdgeSpec hides those knobs. The workspace is mounted into
 * the container, so no file is ever copied by hand.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const IMAGE = process.env.RUNNER_IMAGE ?? "oven/bun:1";
const DOCKER = process.env.RUNNER_DOCKER ?? "docker";
const PORT = Number(process.env.RUNNER_PORT ?? 8899);

export interface RunBody {
  files?: Record<string, string>;
  cwd?: string;
  env?: Record<string, string>;
  command: string;
  timeoutMs?: number;
}

export interface Spawned {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `argv` on the host. Injectable so the sample can be tested without Docker. */
export type Spawn = (argv: string[], timeoutMs: number) => Spawned;

const docker: Spawn = (argv, timeoutMs) => {
  const result = Bun.spawnSync({ cmd: argv, timeout: timeoutMs, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

export async function run(body: RunBody, spawn: Spawn = docker) {
  const root = await mkdtemp(path.join(tmpdir(), "custom-runner-"));
  const timeoutMs = Math.min(body.timeoutMs ?? 180_000, 600_000);
  const cwd = body.cwd ?? "";
  // Request paths must stay inside the workspace; `..` must not reach the host.
  const inside = (name: string) => {
    const target = path.resolve(root, cwd, name);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Path escapes the workspace: ${name}`);
    }
    return target;
  };
  try {
    for (const [name, content] of Object.entries(body.files ?? {})) {
      const target = inside(name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    const mount = root.replace(/\\/g, "/");
    const env = Object.entries(body.env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
    const spawned = spawn(
      [
        DOCKER,
        "run",
        "--rm",
        ...env,
        "-v",
        `${mount}:/work`,
        "-w",
        path.posix.join("/work", cwd),
        IMAGE,
        "bash",
        "-lc",
        body.command,
      ],
      timeoutMs,
    );
    const read = (name: string) =>
      readFile(inside(name), "utf8").then(
        (content) => content,
        () => undefined,
      );
    const files: Record<string, string> = {};
    for (const name of Object.keys(body.files ?? {})) {
      const content = await read(name);
      if (content !== undefined) files[name] = content;
    }
    const lcov = await read("coverage/lcov.info");
    return {
      exitCode: spawned.exitCode ?? 1,
      stdout: spawned.stdout.slice(0, 1_000_000),
      stderr: spawned.stderr.slice(0, 1_000_000),
      files,
      artifacts: lcov === undefined ? {} : { "coverage/lcov.info": lcov },
      ...(spawned.exitCode === null ? { timedOut: true } : {}),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  Bun.serve({
    hostname: "127.0.0.1",
    port: PORT,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        const ok = Boolean(Bun.which(DOCKER));
        return Response.json({
          ok,
          version: "0.1.0",
          capabilities: ["v1", "v2", "coverage"],
          provider: DOCKER,
          isolation: "container",
          ...(ok ? {} : { error: `${DOCKER} is not on PATH.` }),
        });
      }
      if (request.method !== "POST" || url.pathname !== "/run") {
        return new Response("not found", { status: 404 });
      }
      return Response.json(await run((await request.json()) as RunBody));
    },
  });
}
