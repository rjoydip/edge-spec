/**
 * AWS Lambda adapter: translates a Function URL event into a `Request`, calls
 * the shared Hono app, and maps the `Response` back. The app stays a Fetch
 * handler on every target; only this file knows Lambda's envelope.
 *
 * Function URL events carry cookies in a separate array and may mark the body
 * base64 — both are handled here, so no route ever sees the difference.
 */

export interface LambdaUrlEvent {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
}

export interface LambdaUrlResult {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body: string;
  isBase64Encoded?: boolean;
}

export type LambdaFetch = (request: Request) => Promise<Response>;

const BASE64 = /^(?:image|audio|video|application\/octet-stream|application\/pdf|font)/;

/** The event's origin. Function URLs are HTTPS-only; the host header is real. */
const originOf = (event: LambdaUrlEvent): string => {
  const host = event.headers?.host ?? event.headers?.["x-forwarded-host"] ?? "lambda.local";
  return `https://${host}`;
};

export function eventToRequest(event: LambdaUrlEvent): Request {
  const url = `${originOf(event)}${event.rawPath}${
    event.rawQueryString ? `?${event.rawQueryString}` : ""
  }`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(name, value);
  }
  if (event.cookies?.length) headers.set("cookie", event.cookies.join("; "));

  const method = event.requestContext?.http?.method ?? "GET";
  const body =
    event.body === undefined
      ? undefined
      : event.isBase64Encoded
        ? (fromB64(event.body) as unknown as BodyInit)
        : event.body;
  return new Request(url, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" || body === undefined ? {} : { body }),
  });
}

/** Maps the app's Response back to a Function URL result. */
export async function responseToResult(response: Response): Promise<LambdaUrlResult> {
  const headers: Record<string, string> = {};
  const cookies: string[] = [];
  // Function URL has no multi-value Set-Cookie: it reads a `cookies` array.
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie") cookies.push(value);
    else headers[name] = value;
  });

  const buffer = new Uint8Array(await response.arrayBuffer());
  const type = response.headers.get("content-type") ?? "";
  const binary = BASE64.test(type);
  return {
    statusCode: response.status,
    headers,
    ...(cookies.length > 0 ? { cookies } : {}),
    body: binary ? toB64(buffer) : new TextDecoder().decode(buffer),
    ...(binary ? { isBase64Encoded: true } : {}),
  };
}

/** Runs one invocation: event → Request → app → result. */
export async function lambdaHandler(
  event: LambdaUrlEvent,
  fetchApp: LambdaFetch,
): Promise<LambdaUrlResult> {
  return responseToResult(await fetchApp(eventToRequest(event)));
}

const fromB64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/** Chunked so large bodies cannot blow the call stack. */
const toB64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
};
