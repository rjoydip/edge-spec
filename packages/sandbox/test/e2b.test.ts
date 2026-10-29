import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DriverContext } from "../src/driver";
import { createE2bDriver, e2bHealth, type E2bModule } from "../src/e2b";

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "edgespec-e2b-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function fakeE2b() {
  const calls: string[] = [];
  const files: Record<string, string> = {};
  const sandbox = {
    sandboxId: "sbx-1",
    commands: {
      async run(
        command: string,
        options?: {
          cwd?: string;
          envs?: Record<string, string>;
          background?: boolean;
        },
      ) {
        calls.push(`${options?.background ? "bg" : "fg"}:${command}`);
        if (command === "bun test") {
          files["/home/user/workspace/coverage/lcov.info"] = "SF:remote.ts\n";
        }
        return {
          exitCode: 0,
          stdout: `ran ${command} in ${options?.cwd}`,
          stderr: "",
        };
      },
    },
    files: {
      async write(target: string, content: string | Uint8Array) {
        files[target] = typeof content === "string" ? content : new TextDecoder().decode(content);
      },
      async read(target: string) {
        const found = files[target];
        if (found === undefined) throw new Error(`missing ${target}`);
        return found;
      },
    },
    getHost(port: number) {
      return `${port}-sbx.e2b.app`;
    },
    async kill() {
      calls.push("kill");
    },
  };
  const module: E2bModule = {
    Sandbox: {
      async create() {
        calls.push("create");
        return sandbox;
      },
    },
  };
  return { calls, files, module };
}

function context(root: string): DriverContext {
  return {
    root,
    cwd: root,
    env: { NODE_ENV: "test" },
    readyUrl: "http://127.0.0.1:3000/health",
  };
}

describe("e2bHealth", () => {
  it("refuses to claim health without a key", async () => {
    const health = await e2bHealth({});
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/E2B_API_KEY/);
  });

  it("reports a missing SDK instead of a healthy sandbox", async () => {
    const health = await e2bHealth({ apiKey: "k" }, async () => {
      throw new Error("Cannot find package 'e2b'");
    });
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/bun add e2b/);
  });
});

describe("createE2bDriver", () => {
  it("uploads the workspace, skipping dependencies, and downloads artifacts", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "a.test.ts"), "test", "utf8");
    await mkdir(path.join(root, "node_modules", "x"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "x", "index.js"), "skip", "utf8");
    await mkdir(path.join(root, "coverage"), { recursive: true });
    await writeFile(path.join(root, "coverage", "lcov.info"), "SF:a.ts\n", "utf8");

    const fake = fakeE2b();
    const driver = createE2bDriver(
      context(root),
      { apiKey: "k" },
      { load: async () => fake.module },
    );

    await driver.start();
    expect(driver.readyUrl).toBe("https://3000-sbx.e2b.app/health");
    await driver.prepare?.(root);

    expect(fake.files["/home/user/workspace/a.test.ts"]).toBe("test");
    expect(fake.files["/home/user/workspace/node_modules/x/index.js"]).toBeUndefined();

    const result = await driver.exec("bun test", { timeoutMs: 10_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ran bun test in /home/user/workspace");

    await driver.fetchArtifacts?.(root, ["coverage/lcov.info"]);
    expect(await readFile(path.join(root, "coverage", "lcov.info"), "utf8")).toBe("SF:remote.ts\n");

    await driver.close();
    expect(fake.calls).toEqual(["create", "fg:bun test", "kill"]);
  });

  it("refuses to start without a key", () => {
    expect(() => createE2bDriver(context("."), {})).toThrow(/E2B_API_KEY/);
  });
});
