/**
 * The S3 adapter is the only path to object storage off Cloudflare, so its
 * signing, path encoding and 404 semantics get their own test.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { s3Store } from "../src/node/s3";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Seen {
  url: string;
  method: string;
  contentType: string | null;
  authorization: string | null;
}

function capture(respond: (url: string) => Response): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    seen.push({
      url: request.url,
      method: request.method,
      contentType: request.headers.get("content-type"),
      authorization: request.headers.get("authorization"),
    });
    return respond(request.url);
  }) as typeof fetch;
  return seen;
}

const store = (overrides: Partial<Parameters<typeof s3Store>[0]> = {}) =>
  s3Store({
    endpoint: "https://s3.us-east-1.amazonaws.com/",
    bucket: "edge-spec",
    region: "us-east-1",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret",
    ...overrides,
  });

describe("s3 store", () => {
  it("signs a prefixed PUT and keeps the content type", async () => {
    const seen = capture(() => new Response("", { status: 200 }));

    await store({ prefix: "runs" }).put("a/b.json", "{}", {
      httpMetadata: { contentType: "application/json" },
    });

    expect(seen[0]?.url).toBe("https://s3.us-east-1.amazonaws.com/edge-spec/runs/a/b.json");
    expect(seen[0]?.method).toBe("PUT");
    expect(seen[0]?.contentType).toBe("application/json");
    expect(seen[0]?.authorization?.startsWith("AWS4-HMAC-SHA256")).toBe(true);
  });

  it("reads an object and maps a missing key to null", async () => {
    capture((url) =>
      url.endsWith("/missing.json")
        ? new Response("not found", { status: 404 })
        : new Response("hello", { status: 200 }),
    );

    const present = await store().get("present.json");
    expect(await present?.text()).toBe("hello");
    expect(await store().get("missing.json")).toBeNull();
  });

  it("tolerates a missing key on delete and reports a real failure", async () => {
    capture((url) =>
      url.endsWith("/missing.json")
        ? new Response("not found", { status: 404 })
        : new Response("broken", { status: 500 }),
    );

    await store().delete("missing.json");
    await expect(store().delete("broken.json")).rejects.toThrow("S3 DELETE");
    await expect(store().put("broken.json", "{}")).rejects.toThrow("S3 PUT");
  });
});

describe("s3 retry policy", () => {
  // aws4fetch retries 5xx and 429 ten times by default, which stalls an
  // artifact write for the better part of a minute. The adapter caps it at two.
  it("retries a 5xx twice, then gives up", async () => {
    const seen = capture(() => new Response("broken", { status: 503 }));

    await expect(store().put("artifact.json", "{}")).rejects.toThrow("S3 PUT");
    expect(seen.length).toBe(3);
  });

  it("retries a 429", async () => {
    const seen = capture(() => new Response("slow down", { status: 429 }));

    await expect(store().delete("artifact.json")).rejects.toThrow("S3 DELETE");
    expect(seen.length).toBe(3);
  });

  it("does not retry a 404 or a success", async () => {
    const missing = capture(() => new Response("not found", { status: 404 }));
    await store().get("missing.json");
    expect(missing.length).toBe(1);

    const ok = capture(() => new Response("", { status: 200 }));
    await store().delete("present.json");
    expect(ok.length).toBe(1);
  });
});
