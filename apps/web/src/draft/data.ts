/** Fixtures for the redesign draft. Nothing here talks to the Worker. */

export type DraftPhase =
  "idle" | "scanning" | "analyzing" | "testing" | "fixing" | "review" | "dispatched";

export const PHASE_RANK: Record<DraftPhase, number> = {
  idle: 0,
  scanning: 1,
  analyzing: 2,
  testing: 3,
  fixing: 4,
  review: 5,
  dispatched: 6,
};

export type StageId = "clone" | "analyze" | "test" | "fix";

export const STAGE_IDS: StageId[] = ["clone", "analyze", "test", "fix"];

export interface DraftGap {
  path: string;
  kind: "missing" | "coverage" | "api";
  risk: "high" | "medium" | "low";
  note: string;
  /** Present for coverage gaps: the measured line coverage, from LCOV. */
  covered?: number;
}

export const GAPS: DraftGap[] = [
  { path: "src/auth/session.ts", kind: "missing", risk: "high", note: "No sibling test" },
  { path: "src/edge/middleware.ts", kind: "missing", risk: "high", note: "No sibling test" },
  { path: "src/api/sync.ts", kind: "api", risk: "high", note: "Contract drift" },
  { path: "src/webhooks/github.ts", kind: "missing", risk: "high", note: "No sibling test" },
  { path: "src/api/users.ts", kind: "missing", risk: "medium", note: "No sibling test" },
  {
    path: "src/runtime/cache.ts",
    kind: "coverage",
    risk: "medium",
    note: "41% covered",
    covered: 41,
  },
  { path: "src/auth/tokens.ts", kind: "missing", risk: "medium", note: "No sibling test" },
  {
    path: "src/queue/retry.ts",
    kind: "coverage",
    risk: "medium",
    note: "58% covered",
    covered: 58,
  },
  { path: "src/lib/headers.ts", kind: "missing", risk: "low", note: "No sibling test" },
  { path: "src/lib/time.ts", kind: "missing", risk: "low", note: "No sibling test" },
  { path: "src/routes/health.ts", kind: "missing", risk: "low", note: "No sibling test" },
  { path: "src/routes/openapi.ts", kind: "missing", risk: "low", note: "No sibling test" },
  { path: "src/lib/base64.ts", kind: "missing", risk: "low", note: "No sibling test" },
  { path: "src/workers/edge.ts", kind: "missing", risk: "low", note: "No sibling test" },
];

export interface EndpointLog {
  at: string;
  level: "info" | "warn" | "success" | "error";
  text: string;
}

export interface DraftEndpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  http: number;
  ms: number;
  operationId?: string;
  /** The baseline status, when the test was corrected and now passes. */
  firstHttp?: number;
  outcome?: "fixed" | "skipped";
  note?: string;
  request?: string;
  response?: string;
  logs?: EndpointLog[];
}

export const ENDPOINTS: DraftEndpoint[] = [
  {
    method: "GET",
    path: "/api/v1/users",
    http: 200,
    ms: 41,
    operationId: "listUsers",
    request: `curl "$BASE_URL/api/v1/users?limit=2" \\\n  -H "authorization: Bearer $TOKEN"`,
    response: `{\n  "data": [\n    { "id": "usr_1", "email": "ada@acme.dev" },\n    { "id": "usr_2", "email": "lin@acme.dev" }\n  ],\n  "nextCursor": null\n}`,
    logs: [
      { at: "08.2s", level: "info", text: "GET /api/v1/users · fixtures loaded from users.json" },
      {
        at: "08.3s",
        level: "success",
        text: "200 in 41ms · schema matched the documented users[]",
      },
    ],
  },
  {
    method: "POST",
    path: "/api/v1/users",
    http: 201,
    ms: 88,
    operationId: "createUser",
  },
  { method: "GET", path: "/api/v1/users/{id}", http: 200, ms: 33, operationId: "getUser" },
  { method: "PATCH", path: "/api/v1/users/{id}", http: 200, ms: 64, operationId: "updateUser" },
  { method: "DELETE", path: "/api/v1/users/{id}", http: 204, ms: 52, operationId: "deleteUser" },
  { method: "GET", path: "/api/v1/projects", http: 200, ms: 47, operationId: "listProjects" },
  { method: "POST", path: "/api/v1/projects", http: 201, ms: 91, operationId: "createProject" },
  { method: "GET", path: "/api/v1/keys", http: 200, ms: 29, operationId: "listKeys" },
  { method: "POST", path: "/api/v1/keys", http: 201, ms: 73, operationId: "createKey" },
  { method: "GET", path: "/api/v1/sync", http: 200, ms: 38, operationId: "getSync" },
  {
    method: "POST",
    path: "/api/v1/sync",
    http: 200,
    firstHttp: 500,
    ms: 412,
    operationId: "startSync",
    outcome: "fixed",
    note: "The contract test sent a text/plain body; the spec declares application/json. The corrected test sends JSON. The app was not modified.",
    request: `curl -X POST "$BASE_URL/api/v1/sync" \\\n  -H "content-type: application/json" \\\n  -d '{"cursor":"cur_9","mode":"delta"}'`,
    response: `{\n  "synced": 12,\n  "nextCursor": "cur_21",\n  "tookMs": 91\n}`,
    logs: [
      { at: "09.1s", level: "warn", text: "POST /api/v1/sync → 500 · body sent as text/plain" },
      {
        at: "09.2s",
        level: "info",
        text: "spec declares requestBody application/json · retrying with JSON",
      },
      {
        at: "09.4s",
        level: "warn",
        text: "contract test corrected (generated file, not app source)",
      },
      { at: "09.5s", level: "success", text: "200 in 412ms · synced 12 rows" },
    ],
  },
  {
    method: "GET",
    path: "/api/v1/audit",
    http: 401,
    ms: 12,
    operationId: "listAudit",
    outcome: "skipped",
    note: "Security scheme needs a token fixture. Skipped, not passed — no result is invented.",
    response: `{\n  "error": "unauthorized"\n}`,
    logs: [
      {
        at: "10.1s",
        level: "warn",
        text: "GET /api/v1/audit · bearerAuth declared, no token fixture",
      },
      {
        at: "10.1s",
        level: "info",
        text: "marked skipped · add a token fixture in Settings → Contract",
      },
    ],
  },
  { method: "GET", path: "/api/v1/health", http: 200, ms: 8, operationId: "health" },
  {
    method: "GET",
    path: "/api/v1/openapi.json",
    http: 200,
    ms: 18,
    operationId: "openapiDocument",
  },
];

export interface LogLine {
  at: string;
  stage: StageId;
  level: "info" | "ai" | "warn" | "success" | "error";
  text: string;
}

export const LOGS: LogLine[] = [
  { at: "00.0s", stage: "clone", level: "info", text: "cloning acme/edge-api@main · depth 1" },
  {
    at: "00.6s",
    stage: "clone",
    level: "info",
    text: "2,140 files in the tree · 318 source, 204 tests",
  },
  {
    at: "00.8s",
    stage: "clone",
    level: "success",
    text: "AST parsed · 12 route modules, 3 workers",
  },
  { at: "01.4s", stage: "analyze", level: "info", text: "matching sources to sibling tests" },
  {
    at: "01.7s",
    stage: "analyze",
    level: "warn",
    text: "14 gaps · 11 missing, 2 coverage, 1 contract",
  },
  {
    at: "01.9s",
    stage: "analyze",
    level: "info",
    text: "coverage from lcov.info · 41% and 58% in two files",
  },
  {
    at: "02.0s",
    stage: "analyze",
    level: "info",
    text: "1 OpenAPI document · openapi.yaml · 14 operations",
  },
  {
    at: "03.1s",
    stage: "test",
    level: "info",
    text: "sandbox: docker · namespace isolation · bun 1.4.4",
  },
  { at: "03.4s", stage: "test", level: "success", text: "GET /api/v1/users · 200 · 41ms" },
  { at: "03.7s", stage: "test", level: "success", text: "POST /api/v1/users · 201 · 88ms" },
  {
    at: "04.2s",
    stage: "test",
    level: "warn",
    text: "POST /api/v1/sync → 500 · contract test body mismatch",
  },
  {
    at: "04.5s",
    stage: "test",
    level: "warn",
    text: "GET /api/v1/audit · skipped · no token fixture",
  },
  { at: "04.9s", stage: "test", level: "success", text: "12/14 passed · 1 failed · 1 skipped" },
  { at: "05.4s", stage: "fix", level: "ai", text: "writing src/auth/session.test.ts (1/4)" },
  {
    at: "05.9s",
    stage: "fix",
    level: "ai",
    text: "writing src/edge/middleware.test.ts (2/4)",
  },
  { at: "06.3s", stage: "fix", level: "ai", text: "writing src/api/sync.test.ts (3/4)" },
  {
    at: "06.9s",
    stage: "fix",
    level: "ai",
    text: "correcting the sync contract test (attempt 1/3)",
  },
  { at: "07.4s", stage: "fix", level: "success", text: "sync contract corrected · 200 · 412ms" },
  { at: "07.8s", stage: "fix", level: "info", text: "typecheck · bun check · 0 errors" },
  { at: "08.1s", stage: "fix", level: "info", text: "lint · oxlint · 0 findings" },
  {
    at: "08.6s",
    stage: "fix",
    level: "success",
    text: "4 tests ready for review · decisions required",
  },
];

export const CHECKS = [
  { kind: "format", ok: true, ms: 110 },
  { kind: "lint", ok: true, ms: 240 },
  { kind: "typecheck", ok: true, ms: 820 },
  { kind: "test", ok: true, ms: 412 },
] as const;

export interface GeneratedFile {
  source: string;
  test: string;
  provider: string;
  model: string;
}

export const GENERATED: GeneratedFile[] = [
  {
    source: "src/auth/session.ts",
    test: "src/auth/session.test.ts",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
  },
  {
    source: "src/edge/middleware.ts",
    test: "src/edge/middleware.test.ts",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
  },
  {
    source: "src/api/sync.ts",
    test: "src/api/sync.test.ts",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
  },
  {
    source: "openapi.yaml",
    test: "openapi.contract.test.ts",
    provider: "openapi",
    model: "deterministic",
  },
];

export const DIFFS: Record<string, string[]> = {
  "src/auth/session.ts": [
    'import { describe, expect, it } from "bun:test";',
    'import { sessionFor } from "../src/auth/session";',
    "",
    'describe("Auth Edge Runtime", () => {',
    '  it("rejects a request with no cookie", async () => {',
    "    const request = new Request(",
    '      "https://edge.test/api/v1/users",',
    "    );",
    "    const session = await sessionFor(request);",
    "    expect(session).toBeNull();",
    "  });",
    "",
    '  it("rotates an expired token once", async () => {',
    '    const session = await sessionFor(requestWith("expired"));',
    "    expect(session?.rotated).toBe(true);",
    '    expect(session?.token).not.toBe("expired");',
    "  });",
    "",
    '  it("keeps the tenant on a forged header", async () => {',
    '    const session = await sessionFor(requestWith("x-tenant", "other"));',
    '    expect(session?.tenant).toBe("acme");',
    "  });",
    "});",
  ],
  "src/edge/middleware.ts": [
    'import { describe, expect, it } from "bun:test";',
    'import { withEdgeHeaders } from "../src/edge/middleware";',
    "",
    'describe("Edge middleware", () => {',
    '  it("adds the request id once", () => {',
    "    const headers = withEdgeHeaders(new Headers());",
    '    expect(headers.get("x-request-id")).toMatch(/^req_/);',
    "  });",
    "",
    '  it("keeps a caller-supplied request id", () => {',
    '    const headers = withEdgeHeaders(new Headers({ "x-request-id": "req_1" }));',
    '    expect(headers.get("x-request-id")).toBe("req_1");',
    "  });",
    "});",
  ],
  "src/api/sync.ts": [
    'import { describe, expect, it } from "bun:test";',
    'import { applyDelta } from "../src/api/sync";',
    "",
    'describe("Sync delta", () => {',
    '  it("advances the cursor on an empty delta", () => {',
    '    const next = applyDelta({ cursor: "cur_1", rows: [] });',
    '    expect(next.cursor).toBe("cur_1");',
    "  });",
    "",
    '  it("rejects a cursor from another tenant", () => {',
    '    expect(() => applyDelta({ cursor: "cur_other", rows: [] })).toThrow();',
    "  });",
    "});",
  ],
  "openapi.yaml": [
    'import { describe, expect, it } from "bun:test";',
    "",
    'const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";',
    "",
    'describe("openapi.yaml contract", () => {',
    '  it("POST /api/v1/sync accepts JSON", async () => {',
    "    const response = await fetch(`${BASE}/api/v1/sync`, {",
    '      method: "POST",',
    '      headers: { "content-type": "application/json" },',
    '      body: JSON.stringify({ cursor: "cur_9", mode: "delta" }),',
    "    });",
    "    expect(response.status).toBe(200);",
    "    const body = await response.json();",
    '    expect(typeof body.synced).toBe("number");',
    "  });",
    "",
    '  it("GET /api/v1/audit requires a bearer token", async () => {',
    "    const response = await fetch(`${BASE}/api/v1/audit`);",
    "    expect(response.status).toBe(401);",
    "  });",
    "});",
  ],
};

export const SOURCES: Record<string, string[]> = {
  "src/auth/session.ts": [
    'import type { Session } from "./types";',
    "",
    "export async function sessionFor(request: Request): Promise<Session | null> {",
    '  const cookie = request.headers.get("cookie");',
    "  if (!cookie) return null;",
    "  const token = readToken(cookie);",
    "  if (!token) return null;",
    "  const session = await verify(token);",
    "  if (session.expired) return rotate(session);",
    "  return { ...session, tenant: tenantOf(request) ?? session.tenant };",
    "}",
  ],
  "src/edge/middleware.ts": [
    "export function withEdgeHeaders(headers: Headers): Headers {",
    '  if (!headers.has("x-request-id")) {',
    '    headers.set("x-request-id", `req_${crypto.randomUUID()}`);',
    "  }",
    '  headers.set("x-edge-runtime", "workerd");',
    "  return headers;",
    "}",
  ],
  "src/api/sync.ts": [
    "export function applyDelta(input: Delta): Delta {",
    "  assertTenant(input.cursor);",
    "  if (input.rows.length === 0) return input;",
    "  return { cursor: nextCursor(input), rows: dedupe(input.rows) };",
    "}",
  ],
  "openapi.yaml": [
    "openapi: 3.1.0",
    "info:",
    "  title: Edge API",
    "  version: 1.4.0",
    "paths:",
    "  /api/v1/sync:",
    "    post:",
    "      operationId: startSync",
    "      requestBody:",
    "        content:",
    "          application/json:",
    "            schema: { $ref: '#/components/schemas/SyncRequest' }",
    "      responses:",
    "        '200': { description: Delta applied }",
  ],
};

export const SPEC_YAML = `openapi: 3.1.0
info:
  title: Edge API
  version: 1.4.0
  description: Users, projects, keys, sync and audit for the edge runtime.
servers:
  - url: http://127.0.0.1:3000
security:
  - bearerAuth: []
paths:
  /api/v1/users:
    get:
      operationId: listUsers
      parameters:
        - { name: limit, in: query, schema: { type: integer, maximum: 100 } }
      responses:
        "200": { description: A page of users }
    post:
      operationId: createUser
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/UserInput" }
      responses:
        "201": { description: Created }
  /api/v1/sync:
    post:
      operationId: startSync
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/SyncRequest" }
      responses:
        "200": { description: Delta applied }
  /api/v1/audit:
    get:
      operationId: listAudit
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Audit entries }
        "401": { description: Missing token }
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
  schemas:
    UserInput:
      type: object
      required: [email]
      properties:
        email: { type: string, format: email }
    SyncRequest:
      type: object
      required: [cursor]
      properties:
        cursor: { type: string }
        mode: { type: string, enum: [delta, full] }
`;

export const FACTS = {
  repo: "acme/edge-api",
  ref: "main",
  files: 2140,
  sourceFiles: 318,
  testFiles: 204,
  languages: [
    { name: "TypeScript", count: 284 },
    { name: "JavaScript", count: 22 },
    { name: "CSS", count: 12 },
  ],
  runtime: "Bun 1.4.4",
  packageManager: "bun@1.4.4",
  frameworks: ["Hono", "Vite", "Vitest compatibility"],
  formatter: "Bun",
  coverage: { status: "measured", file: "coverage/lcov.info" },
  checks: [
    { kind: "format", command: "bun fmt --check ." },
    { kind: "lint", command: "oxlint . --deny-warnings" },
    { kind: "typecheck", command: "bun check" },
    { kind: "test", command: "bun test" },
  ],
} as const;

export const RECENT_PRS = [
  {
    number: 128,
    title: "test: cover the auth edge runtime",
    state: "open",
    files: 8,
    checks: "passing",
  },
  {
    number: 124,
    title: "test: add contract tests for openapi.yaml",
    state: "merged",
    files: 14,
    checks: "passing",
  },
  { number: 119, title: "test: cover queue retries", state: "merged", files: 3, checks: "passing" },
  {
    number: 116,
    title: "test: webhook signature gaps",
    state: "closed",
    files: 5,
    checks: "failing",
  },
] as const;
