import { describe, expect, it } from "bun:test";
import {
  SANDBOX_PROVIDERS,
  checkSandboxHealth,
  parseSandboxConfig,
  runInSandbox,
  sandboxProvidersFor,
  sandboxRepo,
  type SandboxConfig,
} from "../src/sandbox";

const fakeFetch = (reply: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(reply), { status })) as unknown as typeof fetch;

describe("parseSandboxConfig", () => {
  it("keeps the valid fields and clamps the numbers", () => {
    const config = parseSandboxConfig({
      setup: ["bun install"],
      env: { NODE_ENV: "test" },
      server: { command: "bun run dev", readyUrl: "http://127.0.0.1:3000/health" },
      timeoutMs: 5,
      concurrency: 99,
      coverage: true,
      cwd: "packages/api",
    });
    expect(config.timeoutMs).toBe(10_000);
    expect(config.concurrency).toBe(4);
    expect(config.setup).toEqual(["bun install"]);
    expect(config.server?.readyUrl).toBe("http://127.0.0.1:3000/health");
    expect(config.cwd).toBe("packages/api");
  });

  it("rejects unknown fields, bad env names and escaping cwd", () => {
    expect(() => parseSandboxConfig({ url: "https://x" })).toThrow(/Unknown sandbox config/);
    expect(() => parseSandboxConfig({ env: { "BAD-NAME": "x" } })).toThrow(/not a valid/);
    expect(() => parseSandboxConfig({ cwd: "../../etc" })).toThrow(/inside the sandbox/);
    expect(() => parseSandboxConfig({ server: { command: "x", readyUrl: "file:///etc" } })).toThrow(
      /http or https/,
    );
    expect(() => parseSandboxConfig([])).toThrow(/JSON object/);
  });

  it("is empty for absent input", () => {
    expect(parseSandboxConfig(undefined)).toEqual({});
  });

  it("accepts a known provider and refuses an unknown one", () => {
    expect(parseSandboxConfig({ provider: "docker" }).provider).toBe("docker");
    expect(() => parseSandboxConfig({ provider: "kubernetes" })).toThrow(
      /Unknown sandbox provider/,
    );
  });
});

describe("sandboxRepo", () => {
  it("only clones for a v2 configuration", () => {
    expect(sandboxRepo({ repo: "acme/api", ref: "main", sandbox: {} })).toBeUndefined();
    const repo = sandboxRepo({
      repo: "acme/api",
      ref: "main",
      sandbox: { setup: ["bun install"] },
    });
    expect(repo).toEqual({ url: "https://github.com/acme/api.git", ref: "main" });
  });

  it("sends the token only after an explicit opt-in", () => {
    const base = { repo: "acme/api", ref: "main", token: "ghp_secret" };
    expect(sandboxRepo({ ...base, sandbox: { setup: ["bun install"] } })?.token).toBeUndefined();
    expect(
      sandboxRepo({ ...base, sandbox: { setup: ["bun install"], allowRepoToken: true } })?.token,
    ).toBe("ghp_secret");
  });
});

describe("runInSandbox", () => {
  it("keeps the v1 body when no v2 feature is used", async () => {
    let body: unknown;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ exitCode: 0 }));
    }) as unknown as typeof fetch;

    await runInSandbox({
      sandbox: { url: "https://runner.example", apiKey: "k" },
      files: { "src/a.test.ts": "x" },
      command: "bun test",
      fetchImpl,
    });
    expect(body).toEqual({ files: { "src/a.test.ts": "x" }, command: "bun test" });
  });

  it("upgrades to v2 when a repo, setup or server is used", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ exitCode: 0, stdout: "ok" }));
    }) as unknown as typeof fetch;

    await runInSandbox({
      sandbox: {
        url: "https://runner.example",
        setup: ["bun install"],
        env: { NODE_ENV: "test" },
        server: { command: "bun run dev" },
        coverage: true,
        timeoutMs: 30_000,
      },
      repo: { url: "https://github.com/acme/api.git", ref: "main" },
      command: "bun test",
      fetchImpl,
    });

    expect(body.v).toBe(2);
    expect(body.repo).toEqual({ url: "https://github.com/acme/api.git", ref: "main" });
    expect(body.setup).toEqual(["bun install"]);
    expect(body.server).toEqual({ command: "bun run dev" });
    expect(body.env).toEqual({ NODE_ENV: "test" });
    expect(body.coverage).toEqual({ format: "lcov" });
    expect(body.timeoutMs).toBe(30_000);
  });

  it("asserts the chosen driver with a header, but not for auto or custom", async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push({ ...(init?.headers as Record<string, string>) });
      return new Response(JSON.stringify({ exitCode: 0 }));
    }) as unknown as typeof fetch;

    await runInSandbox({
      sandbox: { url: "https://runner.example", provider: "docker" },
      command: "bun test",
      fetchImpl,
    });
    await runInSandbox({
      sandbox: { url: "https://runner.example", provider: "auto" },
      command: "bun test",
      fetchImpl,
    });
    await runInSandbox({
      sandbox: { url: "https://runner.example", provider: "custom" },
      command: "bun test",
      fetchImpl,
    });

    expect(seen[0]?.["x-sandbox-provider"]).toBe("docker");
    expect(seen[1]?.["x-sandbox-provider"]).toBeUndefined();
    expect(seen[2]?.["x-sandbox-provider"]).toBeUndefined();
  });

  it("turns a setup failure into an environment error, not a test failure", async () => {
    const run = await runInSandbox({
      sandbox: { url: "https://runner.example", setup: ["bun install"] },
      command: "bun test",
      fetchImpl: fakeFetch({ exitCode: 1, stderr: "install failed", environmentError: "setup" }),
    });
    expect(run.ok).toBe(false);
    expect(run.environmentError).toBe("setup");
    expect(run.output).toContain("install failed");
  });

  it("marks a timeout as an environment error", async () => {
    const run = await runInSandbox({
      sandbox: { url: "https://runner.example", timeoutMs: 10_000 },
      command: "bun test",
      fetchImpl: fakeFetch({ exitCode: 137, timedOut: true }),
    });
    expect(run.timedOut).toBe(true);
    expect(run.environmentError).toBe("timeout");
  });

  it("parses LCOV from artifacts only when coverage was requested", async () => {
    const lcov = "SF:src/math.ts\nDA:1,1\nDA:2,0\nend_of_record\n";
    const reply = { exitCode: 0, artifacts: { "coverage/lcov.info": lcov } };

    const measured = await runInSandbox({
      sandbox: { url: "https://runner.example", coverage: true },
      command: "bun test",
      fetchImpl: fakeFetch(reply),
    });
    expect(measured.coverage?.lines).toEqual({ covered: 1, total: 2 });
    expect(measured.coverage?.files[0]?.uncoveredLines).toEqual([2]);

    const notRequested = await runInSandbox({
      sandbox: { url: "https://runner.example" },
      command: "bun test",
      fetchImpl: fakeFetch(reply),
    });
    expect(notRequested.coverage).toBeUndefined();
  });

  it("does not call a runner when none is configured", async () => {
    const run = await runInSandbox({ command: "bun test" });
    expect(run.ok).toBe(false);
    expect(run.output).toContain("No sandbox runner");
  });
});

describe("checkSandboxHealth", () => {
  it("reports the runner's health", async () => {
    const health = await checkSandboxHealth({
      sandbox: { url: "https://runner.example/" } as SandboxConfig,
      fetchImpl: fakeFetch({ ok: true, version: "0.1.0", capabilities: ["v2"] }),
    });
    expect(health).toEqual({ ok: true, version: "0.1.0", capabilities: ["v2"] });
  });

  it("reports the driver, isolation and the runner's own error", async () => {
    const health = await checkSandboxHealth({
      sandbox: { url: "https://runner.example" },
      fetchImpl: fakeFetch({
        ok: false,
        provider: "docker",
        isolation: "container",
        error: "This runner uses docker, not podman.",
      }),
    });
    expect(health.provider).toBe("docker");
    expect(health.isolation).toBe("container");
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/not podman/);
  });

  it("reports an unreachable runner", async () => {
    const fetchImpl = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const health = await checkSandboxHealth({
      sandbox: { url: "https://runner.example" },
      fetchImpl,
    });
    expect(health.ok).toBe(false);
    expect(health.error).toContain("boom");
  });
});

describe("sandboxProvidersFor", () => {
  it("hides the local drivers on a deployed dashboard", () => {
    const ids = sandboxProvidersFor("deployed").map((entry) => entry.id);
    expect(ids).toEqual(["auto", "e2b", "vercel", "daytona", "custom"]);
  });

  it("offers every driver locally", () => {
    expect(sandboxProvidersFor("local").map((entry) => entry.id)).toEqual(
      SANDBOX_PROVIDERS.map((entry) => entry.id),
    );
  });
});
