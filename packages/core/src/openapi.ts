/**
 * Deterministic contract tests. No AI: every operation becomes one named test,
 * and anything the spec does not resolve is skipped with a reason instead of
 * invented. JUnit is parsed back into per-operation facts.
 */
import type { ApiTestResult, Gap, OpenApiEndpoint, OpenApiParameter, OpenApiSpec } from "./types";

export interface SkippedOperation {
  method: string;
  path: string;
  reason: string;
}

export interface ContractFile {
  specPath: string;
  /** `tests/api/<spec-slug>.contract.test.ts`. */
  path: string;
  code: string;
  operations: OpenApiEndpoint[];
  skipped: SkippedOperation[];
}

/** `GET /users/{id}` — the stable name every result maps back to. */
export function contractTestName(operation: Pick<OpenApiEndpoint, "method" | "path">): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

export function contractPathFor(specPath: string): string {
  const file = specPath.slice(specPath.lastIndexOf("/") + 1);
  const base = file.replace(/\.[^.]+$/, "");
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `tests/api/${slug || "openapi"}.contract.test.ts`;
}

/** The base URL the generated file uses: the spec's server, or env at runtime. */
function baseUrlOf(spec: OpenApiSpec): string | undefined {
  return spec.servers?.[0]?.trim() || undefined;
}

/** example -> default -> first enum -> a type placeholder. */
function valueOf(parameter: OpenApiParameter): unknown {
  if (parameter.example !== undefined) return parameter.example;
  if (parameter.default !== undefined) return parameter.default;
  if (parameter.enum && parameter.enum.length > 0) return parameter.enum[0];
  const type = parameter.schema?.type;
  if (type === "integer" || type === "number") return 1;
  if (type === "boolean") return true;
  if (type === "string") return "test";
  return undefined;
}

const asLiteral = (value: unknown): string => JSON.stringify(value);

/** Resolves the parameters of one operation, or says why it cannot. */
function resolveParameters(operation: OpenApiEndpoint): {
  path: string;
  query: Array<[string, string]>;
  headers: Array<[string, string]>;
  reason?: string;
} {
  let path = operation.path;
  const query: Array<[string, string]> = [];
  const headers: Array<[string, string]> = [];

  for (const parameter of operation.parameters ?? []) {
    const value = valueOf(parameter);
    if (parameter.in === "path") {
      if (value === undefined || typeof value === "object") {
        return {
          path,
          query,
          headers,
          reason: `required path parameter "${parameter.name}" has no example, default or enum`,
        };
      }
      path = path.replace(
        new RegExp(`\\{${parameter.name}\\}`, "g"),
        encodeURIComponent(String(value)),
      );
      continue;
    }
    if (!parameter.required) continue;
    if (value === undefined || typeof value === "object") {
      return {
        path,
        query,
        headers,
        reason: `required ${parameter.in} parameter "${parameter.name}" has no example, default or enum`,
      };
    }
    if (parameter.in === "query") query.push([parameter.name, String(value)]);
    else if (parameter.in === "header") headers.push([parameter.name, String(value)]);
    // Cookies are omitted: fetch cannot set them portably.
  }

  return { path, query, headers };
}

/** Statuses the test accepts: documented 2xx/4xx, else any non-5xx answer. */
function allowedStatuses(operation: OpenApiEndpoint): number[] {
  const documented = (operation.responses ?? [])
    .map((status) => Number(status))
    .filter((status) => Number.isInteger(status) && status >= 200 && status < 500);
  return documented.length > 0
    ? [...new Set(documented)].sort((a, b) => a - b)
    : [200, 201, 202, 204, 301, 302, 400, 401, 403, 404, 405, 409, 422];
}

function testCode(
  operation: OpenApiEndpoint,
  spec: OpenApiSpec,
): {
  code: string;
  skipped?: SkippedOperation;
} {
  const name = contractTestName(operation);
  const resolved = resolveParameters(operation);
  const baseUrl = baseUrlOf(spec);
  if (!baseUrl) {
    return {
      code: `  it.skip(${asLiteral(name)}, () => {\n    // no base URL: set servers[0].url in the spec or BASE_URL in the environment.\n  });`,
      skipped: { method: operation.method, path: operation.path, reason: "no base URL" },
    };
  }
  if (resolved.reason) {
    return {
      code: `  it.skip(${asLiteral(name)}, () => {\n    // ${resolved.reason}\n  });`,
      skipped: { method: operation.method, path: operation.path, reason: resolved.reason },
    };
  }

  const url = `${baseUrl.replace(/\/+$/, "")}${resolved.path}`;
  const search = resolved.query.length
    ? ` + "?" + new URLSearchParams(${JSON.stringify(Object.fromEntries(resolved.query))}).toString()`
    : "";
  const headers = Object.fromEntries(resolved.headers);
  const bodyExample =
    operation.requestBody?.example ??
    (operation.requestBody?.schema?.example as unknown) ??
    undefined;
  const init = [
    `method: ${asLiteral(operation.method.toUpperCase())}`,
    ...(Object.keys(headers).length > 0 ? [`headers: ${JSON.stringify(headers)}`] : []),
    ...(bodyExample !== undefined
      ? [
          `headers: ${JSON.stringify({
            "content-type": operation.requestBody?.contentType ?? "application/json",
            ...headers,
          })}`,
          `body: JSON.stringify(${asLiteral(bodyExample)})`,
        ]
      : []),
  ];
  const allowed = allowedStatuses(operation);
  const json = operation.requestBody?.contentType?.includes("json") ?? false;

  return {
    code: [
      `  it(${asLiteral(name)}, async () => {`,
      `    const response = await fetch(BASE_URL + ${asLiteral(url.slice(baseUrl.replace(/\/+$/, "").length))}${search}, {`,
      ...init.map((line) => `      ${line},`),
      `    });`,
      `    expect(${JSON.stringify(allowed)}).toContain(response.status);`,
      ...(json
        ? [`    if (response.ok && response.headers.get("content-type")?.includes("json")) {`]
        : []),
      ...(json ? [`      await response.json();`, `    }`] : []),
      `  });`,
    ].join("\n"),
  };
}

/** One contract file per spec. Deterministic: same input, same source. */
export function contractTestsFor(spec: OpenApiSpec): ContractFile {
  const baseUrl = baseUrlOf(spec);
  const skipped: SkippedOperation[] = [];
  const tests = spec.endpoints.map((operation) => {
    const result = testCode(operation, spec);
    if (result.skipped) skipped.push(result.skipped);
    return result.code;
  });

  const header = [
    `/**`,
    ` * Generated by EdgeSpec from ${spec.path}.`,
    ` * Every test name is "METHOD /path"; change the spec, not this file.`,
    ` */`,
    `import { describe, expect, it } from "bun:test";`,
    ``,
    `const BASE_URL = (process.env.BASE_URL ?? ${asLiteral(baseUrl ?? "")}).replace(/\\/+$/, "");`,
    ``,
    `describe(${asLiteral(`contract: ${spec.title ?? spec.path}`)}, () => {`,
    `  expect(typeof BASE_URL).toBe("string");`,
    ``,
  ];

  return {
    specPath: spec.path,
    path: contractPathFor(spec.path),
    code: [...header, ...tests, `});`, ``].join("\n"),
    operations: spec.endpoints,
    skipped,
  };
}

/** Contract tests that already exist by name, for `apiGaps`. */
function operationNames(tests: Iterable<string>): Set<string> {
  const names = new Set<string>();
  for (const test of tests) {
    const trimmed = test.trim();
    if (!trimmed) continue;
    names.add(trimmed.replace(/\s+/g, " "));
  }
  return names;
}

/** One gap per documented operation with no test named `METHOD /path`. */
export function apiGaps(specs: readonly OpenApiSpec[], tests: Iterable<string> = []): Gap[] {
  const names = operationNames(tests);
  const gaps: Gap[] = [];
  for (const spec of specs) {
    for (const operation of spec.endpoints) {
      const name = contractTestName(operation);
      if (names.has(name)) continue;
      gaps.push({
        path: `${spec.path}#${name}`,
        testPath: contractPathFor(spec.path),
        risk: "medium",
        exports: [],
        reason: `No contract test is named "${name}".`,
        kind: "api",
        evidence: {
          specPath: spec.path,
          operation: {
            method: operation.method,
            path: operation.path,
            ...(operation.operationId ? { operationId: operation.operationId } : {}),
          },
        },
      });
    }
  }
  return gaps;
}

const decodeXml = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return match?.[1] === undefined ? undefined : decodeXml(match[1]);
}

/**
 * Parses the JUnit XML a runner returns. One test per operation is the only
 * shape EdgeSpec generates; anything else is reported as `not-run`.
 */
export function parseJUnit(xml: string, specPath = ""): ApiTestResult[] {
  const results: ApiTestResult[] = [];
  const pattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const match of xml.matchAll(pattern)) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const name = attribute(attributes, "name") ?? "";
    const operation = /^([A-Z]+)\s+(\/\S*)$/.exec(name.trim());
    if (!operation) continue;
    const time = Number(attribute(attributes, "time") ?? "");
    const failed = /<failure\b|<error\b/.test(body);
    const skipped = /<skipped\b/.test(body);
    const message =
      /<failure\b[^>]*\bmessage="([^"]*)"/.exec(body)?.[1] ??
      /<error\b[^>]*\bmessage="([^"]*)"/.exec(body)?.[1];
    results.push({
      specPath,
      method: operation[1] as string,
      path: operation[2] as string,
      status: skipped ? "skipped" : failed ? "failed" : "passed",
      ...(Number.isFinite(time) ? { durationMs: Math.round(time * 1000) } : {}),
      ...(message ? { error: decodeXml(message) } : {}),
    });
  }
  return results;
}
