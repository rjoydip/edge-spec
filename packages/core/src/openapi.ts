/**
 * Deterministic contract tests. No AI: every operation becomes one named test,
 * and anything the spec does not resolve is skipped with a reason instead of
 * invented. JUnit is parsed back into per-operation facts.
 */
import type {
  ApiDiagnosis,
  ApiTestResult,
  Gap,
  OpenApiEndpoint,
  OpenApiParameter,
  OpenApiSpec,
} from "./types";

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

export interface ContractOptions {
  /** A fixture exists; generated code reads it from sandbox env, never includes it. */
  auth?: boolean;
  /** Add missing-field, wrong-type and unauthorized cases. Default true. */
  negative?: boolean;
}

function testCode(
  operation: OpenApiEndpoint,
  spec: OpenApiSpec,
  options: ContractOptions = {},
): {
  code: string;
  skipped?: SkippedOperation;
} {
  const name = contractTestName(operation);
  const resolved = resolveParameters(operation);
  const baseUrl = baseUrlOf(spec);
  const secured = (operation.security?.length ?? 0) > 0;
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
  if (secured && !options.auth) {
    const reason = "security scheme present; no auth fixture was configured";
    return {
      code: `  it.skip(${asLiteral(name)}, () => {\n    // ${reason}\n  });`,
      skipped: { method: operation.method, path: operation.path, reason },
    };
  }

  const path = resolved.path;
  const headers = Object.fromEntries(resolved.headers);
  const bodyExample =
    operation.requestBody?.example ??
    (operation.requestBody?.schema?.example as unknown) ??
    undefined;
  const json = operation.requestBody?.contentType?.includes("json") ?? false;
  const contentType = operation.requestBody?.contentType ?? "application/json";
  const requestHeaders = {
    ...headers,
    ...(bodyExample !== undefined ? { "content-type": contentType } : {}),
  };
  const allowed = allowedStatuses(operation);
  const validationStatuses = [
    ...new Set([
      400,
      422,
      ...allowed.filter(
        (status) => status >= 400 && status < 500 && ![401, 403, 404, 405].includes(status),
      ),
    ]),
  ].sort((left, right) => left - right);
  const schema = operation.requestBody?.schema as Record<string, unknown> | undefined;
  const required = Array.isArray(schema?.required)
    ? schema.required.filter((field): field is string => typeof field === "string")
    : [];
  const properties =
    typeof schema?.properties === "object" && schema.properties !== null
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  const bodyObject =
    bodyExample !== undefined &&
    typeof bodyExample === "object" &&
    bodyExample !== null &&
    !Array.isArray(bodyExample)
      ? (bodyExample as Record<string, unknown>)
      : undefined;

  const negative: string[] = [];
  if (options.negative !== false) {
    if (secured) {
      negative.push(
        `    const unauthorized = await fetch(url, { method: ${asLiteral(operation.method.toUpperCase())}, headers: ${JSON.stringify(headers)}${bodyExample !== undefined ? `, body: JSON.stringify(bodyExample)` : ""} });`,
        `    expect([401, 403]).toContain(unauthorized.status);`,
      );
    }
    if (json && bodyObject) {
      const missingField = required.find((field) => Object.hasOwn(bodyObject, field));
      if (missingField) {
        negative.push(
          `    const missing = { ...bodyExample };`,
          `    delete missing[${asLiteral(missingField)}];`,
          `    const missingResponse = await fetch(url, { method: ${asLiteral(operation.method.toUpperCase())}, headers: { ...${JSON.stringify(requestHeaders)}, ...${options.auth ? "AUTH_HEADERS" : "{}"} }, body: JSON.stringify(missing) });`,
          `    expect(${JSON.stringify(validationStatuses)}).toContain(missingResponse.status);`,
        );
      }
      const typedField = required.find((field) => {
        if (!Object.hasOwn(bodyObject, field)) return false;
        const type = properties[field]?.type;
        return type === "string" || type === "number" || type === "integer" || type === "boolean";
      });
      if (typedField) {
        const type = properties[typedField]?.type;
        const wrong =
          type === "string" ? 12345 : type === "boolean" ? "not-a-boolean" : "not-a-number";
        negative.push(
          `    const wrongType = { ...bodyExample, ${asLiteral(typedField)}: ${asLiteral(wrong)} };`,
          `    const wrongResponse = await fetch(url, { method: ${asLiteral(operation.method.toUpperCase())}, headers: { ...${JSON.stringify(requestHeaders)}, ...${options.auth ? "AUTH_HEADERS" : "{}"} }, body: JSON.stringify(wrongType) });`,
          `    expect(${JSON.stringify(validationStatuses)}).toContain(wrongResponse.status);`,
        );
      }
    }
  }

  return {
    code: [
      `  it(${asLiteral(name)}, async () => {`,
      `    const query = new URLSearchParams(${JSON.stringify(Object.fromEntries(resolved.query))});`,
      ...(options.auth
        ? [
            `    for (const [key, value] of Object.entries(AUTH_QUERY)) query.set(key, String(value));`,
          ]
        : []),
      `    const url = BASE_URL + ${asLiteral(path)} + (query.toString() ? \`?\${query}\` : "");`,
      ...(bodyExample !== undefined ? [`    const bodyExample = ${asLiteral(bodyExample)};`] : []),
      `    const response = await fetch(url, {`,
      `      method: ${asLiteral(operation.method.toUpperCase())},`,
      ...(Object.keys(requestHeaders).length > 0
        ? [
            `      headers: { ...${JSON.stringify(requestHeaders)}, ...${
              options.auth ? "AUTH_HEADERS" : "{}"
            } },`,
          ]
        : options.auth
          ? [`      headers: AUTH_HEADERS,`]
          : []),
      ...(bodyExample !== undefined ? [`      body: JSON.stringify(bodyExample),`] : []),
      `    });`,
      `    expect(${JSON.stringify(allowed)}).toContain(response.status);`,
      ...(json
        ? [`    if (response.ok && response.headers.get("content-type")?.includes("json")) {`]
        : []),
      ...(json ? [`      await response.json();`, `    }`] : []),
      ...negative,
      `  });`,
    ].join("\n"),
  };
}

/**
 * One contract file per spec. Deterministic: same input, same source. A retest
 * passes a filter so the file holds only the operations that failed.
 */
export function contractTestsFor(
  spec: OpenApiSpec,
  filter?: (operation: OpenApiEndpoint) => boolean,
  options: ContractOptions = {},
): ContractFile {
  const baseUrl = baseUrlOf(spec);
  const skipped: SkippedOperation[] = [];
  const operations = filter ? spec.endpoints.filter(filter) : spec.endpoints;
  const tests = operations.map((operation) => {
    const result = testCode(operation, spec, options);
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
    ...(options.auth
      ? [
          `const envJson = (name: string) => {`,
          `  try {`,
          `    const value = JSON.parse(process.env[name] ?? "{}");`,
          `    return value && typeof value === "object" ? value : {};`,
          `  } catch {`,
          `    return {};`,
          `  }`,
          `};`,
          `const AUTH_HEADERS = envJson("EDGESPEC_AUTH_HEADERS");`,
          `const AUTH_QUERY = envJson("EDGESPEC_AUTH_QUERY");`,
        ]
      : []),
    ``,
    `describe(${asLiteral(`contract: ${spec.title ?? spec.path}`)}, () => {`,
    `  expect(typeof BASE_URL).toBe("string");`,
    ``,
  ];

  return {
    specPath: spec.path,
    path: contractPathFor(spec.path),
    code: [...header, ...tests, `});`, ``].join("\n"),
    operations,
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

const DIAGNOSIS_RULES: Array<[ApiDiagnosis, RegExp]> = [
  ["timeout", /timed?\s*out|\btimeout\b|exceeded .*\bms\b|AbortError/i],
  [
    "boot",
    /ECONNREFUSED|connection refused|fetch failed|server (?:is )?not (?:ready|reachable)|\bboot\b/i,
  ],
  ["network", /ENOTFOUND|EAI_AGAIN|socket hang up|network error|getaddrinfo/i],
  [
    "missing-fixture",
    /fixture|missing (?:auth|token|credential)|token (?:is )?(?:missing|not (?:set|provided))/i,
  ],
  ["assertion", /\bassert|expect|toBe|toEqual|Expected:/i],
];

/** A named reason from the failure text. No stack-trace guessing beyond this. */
export function diagnosisOf(text: string): ApiDiagnosis {
  for (const [diagnosis, pattern] of DIAGNOSIS_RULES) {
    if (pattern.test(text)) return diagnosis;
  }
  return "unknown";
}

function firstLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 400);
}

/** The expected/actual pair an assertion prints, when it prints one. */
function expectedActualOf(text: string): { expected?: string; actual?: string } {
  const expected = /Expected:\s*([^\n]+)/i.exec(text)?.[1];
  const actual = /(?:Received|Actual):\s*([^\n]+)/i.exec(text)?.[1];
  const loose = /expected\s+(.+?),?\s+got\s+(.+)/i.exec(text);
  const expectedValue = firstLine(expected ?? loose?.[1] ?? "");
  const actualValue = firstLine(actual ?? loose?.[2] ?? "");
  return {
    ...(expectedValue ? { expected: expectedValue } : {}),
    ...(actualValue ? { actual: actualValue } : {}),
  };
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
    const details =
      /<(?:failure|error)\b[^>]*>([\s\S]*?)<\/(?:failure|error)>/.exec(body)?.[1] ?? "";
    const messageText = message ? decodeXml(message) : "";
    const diagnosticText = `${messageText}\n${decodeXml(details)}`;
    const errorText = messageText || firstLine(decodeXml(details));
    results.push({
      specPath,
      method: operation[1] as string,
      path: operation[2] as string,
      status: skipped ? "skipped" : failed ? "failed" : "passed",
      ...(Number.isFinite(time) ? { durationMs: Math.round(time * 1000) } : {}),
      ...(errorText ? { error: errorText } : {}),
      ...(failed
        ? { diagnosis: diagnosisOf(diagnosticText), ...expectedActualOf(diagnosticText) }
        : {}),
    });
  }
  return results;
}
