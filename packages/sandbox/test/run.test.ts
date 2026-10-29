import { describe, expect, it } from "bun:test";
import path from "node:path";
import {
  EnvironmentFailure,
  containerCwd,
  containerExecArgs,
  containerStartArgs,
  detectDriverKind,
  driverHealth,
  parsePublishedPort,
  portOf,
  providerMismatch,
  type Driver,
} from "../src/driver";
import { bwrapArgs } from "../src/isolation";
import { runInWorkspace, safePath } from "../src/run";

describe("safePath", () => {
  it("keeps a nested path inside the workspace", () => {
    expect(safePath("/work", "src/a.ts")).toBe(path.join("/work", "src/a.ts"));
    expect(safePath("/work", "./src//a.ts")).toBe(path.join("/work", "src/a.ts"));
  });

  it("refuses traversal and absolute paths", () => {
    expect(() => safePath("/work", "../secret")).toThrow(/escapes/);
    expect(() => safePath("/work", "src/../../secret")).toThrow(/escapes/);
    expect(() => safePath("/work", "/etc/passwd")).toThrow(/Absolute/);
    expect(() => safePath("/work", "C:/Windows")).toThrow(/Absolute/);
  });
});

describe("bwrapArgs", () => {
  const args = bwrapArgs({
    bwrap: "/usr/bin/bwrap",
    workdir: "/tmp/run",
    argv: ["bash", "-lc", "bun test"],
    env: { PATH: "/usr/bin", NODE_ENV: "test" },
    egress: false,
    roBinds: ["/usr", "/lib"],
  });

  it("isolates namespaces and never binds the host root", () => {
    expect(args).toContain("--unshare-all");
    expect(args).toContain("--die-with-parent");
    expect(args).toContain("--clearenv");
    expect(args).not.toContain("--share-net");
    // Only the workdir is writable, and / is never a bind source.
    expect(args.filter((value) => value === "--bind")).toHaveLength(1);
    expect(args.slice(args.indexOf("--bind"), args.indexOf("--bind") + 3)).toEqual([
      "--bind",
      "/tmp/run",
      "/tmp/run",
    ]);
    expect(args).not.toContain("/");
  });

  it("carries only the request env and the command after --", () => {
    expect(args.join(" ")).toContain("--setenv NODE_ENV test");
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["bash", "-lc", "bun test"]);
  });

  it("opt-in egress is explicit", () => {
    const shared = bwrapArgs({
      bwrap: "bwrap",
      workdir: "/tmp/run",
      argv: ["true"],
      env: {},
      egress: true,
      roBinds: [],
    });
    expect(shared).toContain("--share-net");
  });
});

describe("container drivers", () => {
  it("bind-mounts the workspace and publishes an ephemeral port", () => {
    const args = containerStartArgs({
      kind: "docker",
      image: "oven/bun:1",
      root: "/tmp/run",
      name: "edgespec-abc",
      readyUrl: "http://127.0.0.1:3000/health",
    });
    expect(args.slice(0, 2)).toEqual(["docker", "run"]);
    expect(args).toContain("-d");
    expect(args).toContain("edgespec-abc");
    expect(args.slice(args.indexOf("-v"), args.indexOf("-v") + 2)).toEqual([
      "-v",
      "/tmp/run:/workspace",
    ]);
    expect(args.slice(args.indexOf("-p"), args.indexOf("-p") + 2)).toEqual([
      "-p",
      "127.0.0.1::3000",
    ]);
    expect(args.slice(-3)).toEqual(["oven/bun:1", "sleep", "infinity"]);
    expect(args).not.toContain("--user");
  });

  it("uses the same argv for Podman plus the SELinux label opt-out", () => {
    const args = containerStartArgs({
      kind: "podman",
      image: "node:22",
      root: "/tmp/run",
      name: "edgespec-abc",
      user: "1000:1000",
    });
    expect(args[0]).toBe("podman");
    expect(args.slice(args.indexOf("--user"), args.indexOf("--user") + 2)).toEqual([
      "--user",
      "1000:1000",
    ]);
    expect(args).toContain("--security-opt");
    expect(args).not.toContain("-p");
  });

  it("runs each command in the mapped cwd with the request env", () => {
    const args = containerExecArgs({
      kind: "docker",
      name: "edgespec-abc",
      cwd: "/workspace/packages/api",
      env: { NODE_ENV: "test", HOME: "/workspace/.edgespec-home" },
      command: "bun test",
    });
    expect(args.slice(0, 2)).toEqual(["docker", "exec"]);
    expect(args.slice(args.indexOf("-w"), args.indexOf("-w") + 2)).toEqual([
      "-w",
      "/workspace/packages/api",
    ]);
    expect(args.join(" ")).toContain("--env NODE_ENV=test");
    expect(args.slice(-3)).toEqual(["bash", "-lc", "bun test"]);
    expect(args).not.toContain("-d");
  });

  it("maps a host directory under the container mount", () => {
    expect(containerCwd("/tmp/run", "/tmp/run")).toBe("/workspace");
    expect(containerCwd("/tmp/run", "/tmp/run/packages/api")).toBe("/workspace/packages/api");
    expect(() => containerCwd("/tmp/run", "/etc")).toThrow(/escapes/);
  });

  it("parses the readiness port and the published port", () => {
    expect(portOf("http://127.0.0.1:3000/health")).toBe(3000);
    expect(portOf("https://app.test/health")).toBe(443);
    expect(portOf("not a url")).toBeUndefined();
    expect(portOf(undefined)).toBeUndefined();
    expect(parsePublishedPort("127.0.0.1:49153\n")).toBe(49153);
    expect(parsePublishedPort("0.0.0.0:3000\n[::]:49154\n")).toBe(3000);
    expect(parsePublishedPort("")).toBeUndefined();
  });
});

describe("detectDriverKind", () => {
  const bwrap = { kind: "bwrap" as const, wrap: (argv: string[]) => argv };
  const none = { kind: "none" as const, wrap: (argv: string[]) => argv };

  it("prefers bwrap, then Docker, then Podman", () => {
    expect(detectDriverKind("auto", bwrap, () => true)).toBe("bwrap");
    expect(detectDriverKind("auto", none, (bin) => bin === "docker")).toBe("docker");
    expect(detectDriverKind("auto", none, (bin) => bin === "podman")).toBe("podman");
    expect(detectDriverKind("auto", none, () => false)).toBe("none");
  });

  it("honours an explicit provider and rejects an unknown one", () => {
    expect(detectDriverKind("podman", bwrap, () => false)).toBe("podman");
    expect(detectDriverKind("e2b", bwrap, () => false)).toBe("e2b");
    expect(detectDriverKind("vercel", bwrap, () => false)).toBe("vercel");
    expect(detectDriverKind("daytona", bwrap, () => false)).toBe("daytona");
    expect(detectDriverKind("bogus", bwrap, () => true)).toBe("none");
  });
});

describe("providerMismatch", () => {
  it("refuses a named driver that differs from this runner", () => {
    expect(providerMismatch("docker", "docker")).toBeUndefined();
    expect(providerMismatch("Docker", "docker")).toBeUndefined();
    expect(providerMismatch("podman", "docker")).toMatch(/uses docker, not podman/);
    expect(providerMismatch("bwrap", "none")).toMatch(/uses none, not bwrap/);
    expect(providerMismatch("vercel", "e2b")).toMatch(/uses e2b, not vercel/);
  });

  it("asserts nothing for auto, custom or an absent header", () => {
    expect(providerMismatch(undefined, "docker")).toBeUndefined();
    expect(providerMismatch("auto", "docker")).toBeUndefined();
    expect(providerMismatch("custom", "docker")).toBeUndefined();
  });
});

describe("driverHealth", () => {
  it("reports the missing isolation boundary", async () => {
    const health = await driverHealth("none");
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/No sandbox driver/);
  });
});

function fakeDriver(log: string[], overrides: Partial<Driver> = {}): Driver {
  return {
    kind: "docker",
    isolation: "container",
    readyUrl: undefined,
    async start() {
      log.push("start");
    },
    async exec(command) {
      log.push(`exec:${command}`);
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
    async startServer(command) {
      log.push(`server:${command}`);
      return {
        alive: () => true,
        output: async () => "app log",
        stop: async () => {
          log.push("server:stop");
        },
      };
    },
    async close() {
      log.push("close");
    },
    ...overrides,
  };
}

describe("runInWorkspace", () => {
  it("refuses a file that escapes the workspace", async () => {
    await expect(
      runInWorkspace(
        { files: { "../escape.ts": "x" }, command: "bun test" },
        { createDriver: () => fakeDriver([]) },
      ),
    ).rejects.toThrow(/escapes/);
  });

  it("runs setup, the server and the command through the driver, then closes", async () => {
    const log: string[] = [];
    const reply = await runInWorkspace(
      {
        setup: ["bun install"],
        server: { command: "bun run dev" },
        command: "bun test",
        files: { "a.test.ts": "1" },
      },
      { createDriver: () => fakeDriver(log) },
    );
    expect(log).toEqual([
      "start",
      "exec:bun install",
      "server:bun run dev",
      "exec:bun test",
      "server:stop",
      "close",
    ]);
    expect(reply.exitCode).toBe(0);
    expect(reply.files["a.test.ts"]).toBe("1");
  });

  it("lets an isolated driver upload before setup and download after the command", async () => {
    const log: string[] = [];
    await runInWorkspace(
      {
        setup: ["bun install"],
        command: "bun test",
        files: { "a.test.ts": "1" },
      },
      {
        createDriver: () =>
          fakeDriver(log, {
            async prepare() {
              log.push("prepare");
            },
            async fetchArtifacts() {
              log.push("fetch");
            },
          }),
      },
    );
    expect(log).toEqual([
      "start",
      "prepare",
      "exec:bun install",
      "exec:bun test",
      "fetch",
      "close",
    ]);
  });

  it("passes artifact paths relative to the workspace root, not the cwd", async () => {
    let paths: string[] = [];
    await runInWorkspace(
      { cwd: "packages/api", command: "bun test", files: { "a.test.ts": "1" } },
      {
        createDriver: () =>
          fakeDriver([], {
            async fetchArtifacts(_root, list) {
              paths = list;
            },
          }),
      },
    );
    expect(paths).toContain("packages/api/a.test.ts");
    expect(paths).toContain("packages/api/coverage/lcov.info");
  });

  it("maps a setup failure to an environment error and still closes", async () => {
    const log: string[] = [];
    const reply = await runInWorkspace(
      { setup: ["bun install"], command: "bun test" },
      {
        createDriver: () =>
          fakeDriver(log, {
            async exec(command) {
              log.push(`exec:${command}`);
              return {
                exitCode: 1,
                stdout: "",
                stderr: "no lockfile",
                timedOut: false,
              };
            },
          }),
      },
    );
    expect(reply.environmentError).toBe("setup");
    expect(reply.exitCode).toBe(1);
    expect(log).toContain("close");
  });

  it("reports a driver that cannot start as an environment error", async () => {
    const reply = await runInWorkspace(
      { command: "bun test" },
      {
        createDriver: () =>
          fakeDriver([], {
            async start() {
              throw new EnvironmentFailure("setup", "docker is not running");
            },
          }),
      },
    );
    expect(reply.environmentError).toBe("setup");
    expect(reply.stderr).toContain("docker is not running");
  });
});
