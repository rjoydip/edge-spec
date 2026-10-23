import { describe, expect, it } from "bun:test";
import { decodeBase64, encodeBase64, GitHub } from "../src/core/github";

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

  it("turns a network failure into a 502", async () => {
    const fakeFetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(new GitHub(undefined, fakeFetch).tree("acme/api", "main")).rejects.toThrow(
      /GitHub unreachable/,
    );
  });
});
