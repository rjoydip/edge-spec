/**
 * Lambda Function URL envelope: the app must never see it. These tests pin the
 * two lossy edges — cookies and base64 bodies — plus method/url handling.
 */
import { describe, expect, test } from "bun:test";
import { eventToRequest, lambdaHandler, responseToResult } from "../src/aws/lambda";

const app = (status = 200, body = "ok", headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

describe("lambda event → Request", () => {
  test("keeps the method, path, query and headers", () => {
    const request = eventToRequest({
      rawPath: "/api/health",
      rawQueryString: "a=1&b=2",
      headers: { host: "abc.lambda-url.us-east-1.on.aws", "x-custom": "yes" },
      requestContext: { http: { method: "POST" } },
    });
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://abc.lambda-url.us-east-1.on.aws/api/health?a=1&b=2");
    expect(request.headers.get("x-custom")).toBe("yes");
  });

  test("joins the cookies array into one Cookie header", () => {
    const request = eventToRequest({
      rawPath: "/api/auth/me",
      headers: { host: "h" },
      cookies: ["edgespec_session=abc", "theme=dark"],
      requestContext: { http: { method: "GET" } },
    });
    expect(request.headers.get("cookie")).toBe("edgespec_session=abc; theme=dark");
  });

  test("decodes a base64 body and omits it for GET", () => {
    const posted = eventToRequest({
      rawPath: "/api/auth/login",
      headers: { host: "h", "content-type": "application/json" },
      body: btoa(JSON.stringify({ email: "a@b.dev" })),
      isBase64Encoded: true,
      requestContext: { http: { method: "POST" } },
    });
    expect(posted.headers.get("content-type")).toBe("application/json");

    const get = eventToRequest({
      rawPath: "/x",
      headers: { host: "h" },
      body: btoa("ignored"),
      isBase64Encoded: true,
      requestContext: { http: { method: "GET" } },
    });
    expect(get.method).toBe("GET");
  });

  test("falls back to a host when headers omit it", () => {
    expect(eventToRequest({ rawPath: "/x", headers: {} }).url).toBe("https://lambda.local/x");
  });
});

describe("Response → lambda result", () => {
  test("splits Set-Cookie into the cookies array", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "a=1; HttpOnly");
    headers.append("set-cookie", "b=2; Path=/");
    const result = await responseToResult(new Response("{}", { headers }));
    expect(result.statusCode).toBe(200);
    expect(result.cookies).toEqual(["a=1; HttpOnly", "b=2; Path=/"]);
    expect(result.headers["content-type"]).toBe("application/json");
    expect(result.body).toBe("{}");
    expect(result.isBase64Encoded).toBeUndefined();
  });

  test("base64-encodes binary bodies", async () => {
    const bytes = new Uint8Array([0, 255, 128]);
    const result = await responseToResult(
      new Response(bytes, { headers: { "content-type": "image/png" } }),
    );
    expect(result.isBase64Encoded).toBe(true);
    expect(atob(result.body)).toBe(String.fromCharCode(...bytes));
  });
});

describe("lambdaHandler", () => {
  test("passes the translated request to the app and returns its result", async () => {
    let seen: Request | undefined;
    const result = await lambdaHandler(
      {
        rawPath: "/api/health",
        headers: { host: "h", accept: "application/json" },
        requestContext: { http: { method: "GET" } },
      },
      async (request) => {
        seen = request;
        return app(200, '{"status":"ok"}', { "content-type": "application/json" });
      },
    );
    expect(seen?.url).toBe("https://h/api/health");
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('{"status":"ok"}');
  });
});
