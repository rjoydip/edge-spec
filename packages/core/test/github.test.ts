import { describe, expect, it } from "bun:test";
import { decodeBase64, encodeBase64, GitHub } from "../src/github";
import { PR_CHECK_MARKER, PR_CHECK_NAME, type PrCheckResult } from "../src/pr-check";

const CHECK: PrCheckResult = {
  conclusion: "neutral",
  output: { title: "Static check only", summary: "summary", annotations: [] },
  comment: `${PR_CHECK_MARKER}\nsummary`,
};

describe("base64 helpers", () => {
  it("round-trips UTF-8 source", () => {
    const text = `const greeting = "héllo — 世界";\n`;
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });
});

describe("GitHub", () => {
  it("sends the visitor's token, a user agent and an API version", async () => {
    let headers: Record<string, string> = {};
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ tree: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await new GitHub("ghp_test", fakeFetch).tree("acme/api", "main");

    expect(headers.authorization).toBe("Bearer ghp_test");
    expect(headers["user-agent"]).toBe("edge-spec");
    expect(headers["x-github-api-version"]).toBe("2022-11-28");
  });

  it("decodes file contents", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ content: encodeBase64("export const x = 1;") }), {
        status: 200,
      })) as unknown as typeof fetch;

    expect(await new GitHub(undefined, fakeFetch).file("acme/api", "src/x.ts")).toBe(
      "export const x = 1;",
    );
  });

  it("lists branch names and drops malformed entries", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify([{ name: "main" }, { name: "dev" }, {}]), {
        status: 200,
      })) as unknown as typeof fetch;

    expect(await new GitHub(undefined, fakeFetch).branches("acme/api")).toEqual(["main", "dev"]);
  });

  it("maps 404 to a readable message without the token", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
      })) as unknown as typeof fetch;

    const error = new GitHub("ghp_secret", fakeFetch).tree("acme/api", "main");
    await expect(error).rejects.toThrow(/repository or path not found/);
    await expect(error).rejects.not.toThrow(/ghp_secret/);
  });

  it("lists the changed files of a pull request", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify([{ filename: "src/a.ts" }, {}, { filename: "src/b.ts" }]), {
        status: 200,
      })) as unknown as typeof fetch;

    expect(await new GitHub(undefined, fakeFetch).pullFiles("acme/api", 7)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("creates one check per commit and patches it on a re-run", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    let existing: Array<{ id: number }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url: String(url),
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (method === "GET") {
        return new Response(JSON.stringify({ check_runs: existing }), { status: 200 });
      }
      if (method === "POST") {
        existing = [{ id: 7 }];
        return new Response(JSON.stringify({ id: 7 }), { status: 201 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const github = new GitHub("token", fakeFetch);
    expect(await github.upsertCheck("acme/api", "abc", CHECK)).toBe(7);
    expect(await github.upsertCheck("acme/api", "abc", CHECK)).toBe(7);

    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls[0]?.url).toContain(`check_name=${encodeURIComponent(PR_CHECK_NAME)}`);
    expect(calls.find((call) => call.method === "PATCH")?.url).toContain("/check-runs/7");
    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({
      head_sha: "abc",
      name: PR_CHECK_NAME,
      conclusion: "neutral",
    });
  });

  it("creates one marked comment and patches it on a re-run", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    let comments: Array<{ id: number; body: string }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url: String(url),
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (method === "GET") {
        return new Response(JSON.stringify(comments), { status: 200 });
      }
      if (method === "POST") {
        comments = [{ id: 9, body: CHECK.comment }];
        return new Response(JSON.stringify({ id: 9 }), { status: 201 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const github = new GitHub("token", fakeFetch);
    expect(await github.upsertPullComment("acme/api", 7, CHECK.comment)).toBe(9);
    expect(await github.upsertPullComment("acme/api", 7, CHECK.comment)).toBe(9);

    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.find((call) => call.method === "PATCH")?.url).toContain("/issues/comments/9");
  });

  it("turns a network failure into a 502", async () => {
    const fakeFetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(new GitHub(undefined, fakeFetch).tree("acme/api", "main")).rejects.toThrow(
      /GitHub unreachable/,
    );
  });
});
