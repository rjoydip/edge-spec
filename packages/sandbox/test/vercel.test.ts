import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DriverContext } from "../src/driver";
import { createVercelDriver, vercelHealth, type VercelModule } from "../src/vercel";

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "edgespec-vercel-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function fakeVercel() {
  const calls: string[] = [];
  const files: Record<string, string> = {};
  const writes: { path: string; content: string }[] = [];
  let created: Record<string, unknown> | undefined;
  const sandbox = {
    domain(port: number) {
      return `https://${port}-sbx.vercel.run`;
    },
    async runCommand(params: { args?: string[]; cwd?: string; detached?: boolean }) {
      const command = params.args?.[1] ?? "";
      calls.push(`${params.detached ? "bg" : "fg"}:${command}`);
      if (params.detached) {
        return {
          async kill() {
            calls.push("kill");
          },
        };
      }
      return {
        exitCode: 0,
        async stdout() {
          if (command === "bun test")
            files["/vercel/edgespec-workspace/coverage/lcov.info"] = "SF:remote.ts\n";
          return `ran ${command} in ${params.cwd}`;
        },
        async stderr() {
          return "";
        },
      };
    },
    async readFileToBuffer(file: { path: string }) {
      const found = files[file.path];
      return found === undefined ? null : Buffer.from(found);
    },
    async writeFiles(list: { path: string; content: string | Uint8Array }[]) {
      for (const file of list) {
        const content =
          typeof file.content === "string" ? file.content : new TextDecoder().decode(file.content);
        writes.push({ path: file.path, content });
        files[file.path] = content;
      }
    },
    async stop() {
      calls.push("stop");
    },
  };
  const module: VercelModule = {
    Sandbox: {
      async create(params: Record<string, unknown>) {
        created = params;
        calls.push("create");
        return sandbox;
      },
    },
  };
  return { calls, files, writes, module, created: () => created };
}

function context(root: string): DriverContext {
  return {
    root,
    cwd: root,
    env: { NODE_ENV: "test" },
    readyUrl: "http://127.0.0.1:3000/health",
  };
}

describe("vercelHealth", () => {
  it("refuses to claim health without a token", async () => {
    const health = await vercelHealth({});
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/VERCEL_TOKEN/);
  });

  it("reports a missing SDK instead of a healthy sandbox", async () => {
    const health = await vercelHealth(
      { token: "t", teamId: "team", projectId: "project" },
      async () => {
        throw new Error("Cannot find package '@vercel/sandbox'");
      },
    );
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/bun add @vercel\/sandbox/);
  });
});

describe("createVercelDriver", () => {
  it("creates a sandbox with the app port, uploads, runs and downloads", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "a.test.ts"), "test", "utf8");
    await mkdir(path.join(root, "node_modules", "x"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "x", "index.js"), "skip", "utf8");
    await mkdir(path.join(root, "coverage"), { recursive: true });
    await writeFile(path.join(root, "coverage", "lcov.info"), "SF:a.ts\n", "utf8");

    const fake = fakeVercel();
    const driver = createVercelDriver(
      context(root),
      { token: "t", teamId: "team", projectId: "project" },
      { load: async () => fake.module },
    );

    await driver.start();
    expect(fake.created()).toMatchObject({
      token: "t",
      teamId: "team",
      projectId: "project",
      ports: [3000],
      timeout: 900_000,
    });
    expect(driver.readyUrl).toBe("https://3000-sbx.vercel.run/health");

    await driver.prepare?.(root);
    expect(fake.writes.map((write) => write.path)).toEqual([
      "/vercel/edgespec-workspace/a.test.ts",
    ]);
    expect(fake.files["/vercel/edgespec-workspace/node_modules/x/index.js"]).toBeUndefined();

    const result = await driver.exec("bun test", { timeoutMs: 10_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ran bun test in /vercel/edgespec-workspace");

    await driver.fetchArtifacts?.(root, ["coverage/lcov.info"]);
    expect(await readFile(path.join(root, "coverage", "lcov.info"), "utf8")).toBe("SF:remote.ts\n");

    await driver.close();
    expect(fake.calls).toEqual(["create", "fg:bun test", "stop"]);
  });

  it("refuses to start without a token", () => {
    expect(() => createVercelDriver(context("."), {})).toThrow(/VERCEL_TOKEN/);
  });
});
