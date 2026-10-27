import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "node:path";

const entry = resolve(import.meta.dir, "../src/index.ts");
let server: ReturnType<typeof Bun.serve>;
let lastGitHubToken: string | null = null;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      lastGitHubToken = request.headers.get("x-github-token");
      const url = new URL(request.url);
      if (url.pathname === "/api/catalog") {
        return Response.json({
          providers: [{ id: "openai", name: "OpenAI", models: [{ id: "test", name: "Test" }] }],
          defaults: { ai: { provider: "openai", model: "test" }, pipeline: {} },
          sandbox: false,
        });
      }
      if (url.pathname === "/api/scan") {
        return Response.json({
          repo: "owner/repo",
          ref: "main",
          scanned: 2,
          gaps: [
            {
              path: "src/a.ts",
              testPath: "src/a.test.ts",
              risk: "high",
              exports: ["a"],
              reason: "no test",
            },
          ],
          overview: {
            languages: [{ name: "TypeScript", count: 2 }],
            frameworks: [],
            totalFiles: 3,
            sourceFiles: 1,
            testFiles: 0,
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop(true);
});

async function run(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, entry, ...args], {
    cwd: resolve(import.meta.dir, "../../.."),
    env: {
      ...process.env,
      EDGESPEC_URL: `http://127.0.0.1:${server.port}`,
      ...env,
    } as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

describe("edge-spec CLI", () => {
  it("prints catalog JSON from a Worker", async () => {
    const result = await run(["catalog", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).providers[0].id).toBe("openai");
  });

  it("scans a repository and sends the GitHub token header", async () => {
    const result = await run(["scan", "owner/repo", "--json"], { GH_TOKEN: "gh-test" });
    expect(result.code).toBe(0);
    const scan = JSON.parse(result.stdout);
    expect(scan.gaps[0].path).toBe("src/a.ts");
    expect(lastGitHubToken).toBe("gh-test");
    expect(result.stderr).toBe("");
  });
});
