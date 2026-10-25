import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run, type Spawn } from "../custom-runner.example";

/** A fake Docker that records the argv and can write into the mounted workspace. */
function fakeDocker(onRun?: (root: string) => void) {
  const calls: string[][] = [];
  const spawn: Spawn = (argv) => {
    calls.push(argv);
    onRun?.((argv[argv.indexOf("-v") + 1] ?? "").replace(/:\/work$/, ""));
    return { exitCode: 0, stdout: "ok", stderr: "" };
  };
  return { calls, spawn };
}

describe("custom runner example", () => {
  it("mounts the workspace, honours cwd/env, and reads files back", async () => {
    const fake = fakeDocker((root) => {
      const base = path.join(root, "packages", "api");
      expect(readFileSync(path.join(base, "a.test.ts"), "utf8")).toBe("test");
      writeFileSync(path.join(base, "a.test.ts"), "formatted", "utf8");
      mkdirSync(path.join(base, "coverage"), { recursive: true });
      writeFileSync(path.join(base, "coverage", "lcov.info"), "SF:a.ts\n", "utf8");
    });
    const reply = await run(
      {
        files: { "a.test.ts": "test" },
        cwd: "packages/api",
        env: { NODE_ENV: "test" },
        command: "bun test",
      },
      fake.spawn,
    );

    const argv = fake.calls[0] ?? [];
    expect(argv.slice(argv.indexOf("-e"), argv.indexOf("-e") + 2)).toEqual(["-e", "NODE_ENV=test"]);
    expect(argv[argv.indexOf("-w") + 1]).toBe("/work/packages/api");
    expect(argv.slice(-2)).toEqual(["-lc", "bun test"]);
    expect(reply.files["a.test.ts"]).toBe("formatted");
    expect(reply.artifacts["coverage/lcov.info"]).toBe("SF:a.ts\n");
    expect(reply.exitCode).toBe(0);
  });

  it("refuses a path that escapes the workspace", async () => {
    await expect(
      run({ files: { "../escape.ts": "x" }, command: "true" }, fakeDocker().spawn),
    ).rejects.toThrow(/escapes the workspace/);
  });

  it("cleans up and reports a killed run as timedOut", async () => {
    let root = "";
    const reply = await run({ files: { "a.test.ts": "test" }, command: "sleep 999" }, (argv) => {
      root = (argv[argv.indexOf("-v") + 1] ?? "").replace(/:\/work$/, "");
      return { exitCode: null, stdout: "", stderr: "" };
    });
    expect(reply.timedOut).toBe(true);
    expect(existsSync(root)).toBe(false);
  });
});
