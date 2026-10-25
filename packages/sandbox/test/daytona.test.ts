import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DriverContext } from "../src/driver";
import { createDaytonaDriver, daytonaHealth, type DaytonaModule } from "../src/daytona";

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "edgespec-daytona-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function fakeDaytona() {
  const calls: string[] = [];
  const files: Record<string, string> = {};
  let created: Record<string, unknown> | undefined;
  const sandbox = {
    process: {
      async executeCommand(command: string, cwd?: string) {
        calls.push(`exec:${command}`);
        if (command === "bun test") {
          files["edgespec-workspace/coverage/lcov.info"] = "SF:remote.ts\n";
        }
        return { exitCode: 0, result: `ran ${command} in ${cwd}` };
      },
    },
    fs: {
      async uploadFile(content: Buffer, remote: string) {
        files[remote] = content.toString();
      },
      async downloadFile(remote: string, local: string) {
        await writeFile(local, files[remote] ?? "", "utf8");
      },
    },
    async getSignedPreviewUrl(port: number) {
      calls.push(`signed:${port}`);
      return { url: `https://${port}-sbx.daytona.work?token=abc` };
    },
    async delete() {
      calls.push("delete");
    },
  };
  const module: DaytonaModule = {
    Daytona: class {
      async create(params?: Record<string, unknown>) {
        created = params;
        calls.push("create");
        return sandbox;
      }
    } as unknown as DaytonaModule["Daytona"],
  };
  return { calls, files, module, created: () => created };
}

function context(root: string): DriverContext {
  return {
    root,
    cwd: root,
    env: { NODE_ENV: "test", HOME: "/host/home", TMPDIR: "/host/tmp" },
    readyUrl: "http://127.0.0.1:3000/health",
  };
}

describe("daytonaHealth", () => {
  it("refuses to claim health without a key", async () => {
    const health = await daytonaHealth({});
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/DAYTONA_API_KEY/);
  });

  it("reports a missing SDK instead of a healthy sandbox", async () => {
    const health = await daytonaHealth({ apiKey: "k" }, async () => {
      throw new Error("Cannot find package '@daytona/sdk'");
    });
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/bun add @daytona\/sdk/);
  });
});

describe("createDaytonaDriver", () => {
  it("signs the readiness URL, uploads, runs and downloads", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "a.test.ts"), "test", "utf8");
    await mkdir(path.join(root, "node_modules", "x"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "x", "index.js"), "skip", "utf8");
    await mkdir(path.join(root, "coverage"), { recursive: true });
    await writeFile(path.join(root, "coverage", "lcov.info"), "SF:a.ts\n", "utf8");

    const fake = fakeDaytona();
    const driver = createDaytonaDriver(
      context(root),
      { apiKey: "k" },
      { load: async () => fake.module },
    );

    await driver.start();
    expect(fake.created()).toMatchObject({ ephemeral: true, envVars: { TMPDIR: "/tmp" } });
    expect(fake.created()?.envVars).not.toMatchObject({ HOME: "/host/home" });
    expect(driver.readyUrl).toBe("https://3000-sbx.daytona.work/health?token=abc");

    await driver.prepare?.(root);
    expect(fake.files["edgespec-workspace/a.test.ts"]).toBe("test");
    expect(fake.files["edgespec-workspace/node_modules/x/index.js"]).toBeUndefined();

    const result = await driver.exec("bun test", { timeoutMs: 180_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ran bun test in edgespec-workspace");

    await driver.fetchArtifacts?.(root, ["coverage/lcov.info"]);
    expect(await readFile(path.join(root, "coverage", "lcov.info"), "utf8")).toBe("SF:remote.ts\n");

    await driver.close();
    expect(fake.calls).toEqual(["create", "signed:3000", "exec:bun test", "delete"]);
  });

  it("refuses to start without a key", () => {
    expect(() => createDaytonaDriver(context("."), {})).toThrow(/DAYTONA_API_KEY/);
  });
});
