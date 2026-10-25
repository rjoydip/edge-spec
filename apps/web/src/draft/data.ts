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

export interface DraftGap {
  path: string;
  kind: "missing" | "coverage" | "api";
  risk: "high" | "medium" | "low";
  note: string;
}

export const GAPS: DraftGap[] = [
  { path: "src/auth/session.ts", kind: "missing", risk: "high", note: "No sibling test" },
  { path: "src/edge/middleware.ts", kind: "missing", risk: "high", note: "No sibling test" },
  { path: "src/api/sync.ts", kind: "api", risk: "high", note: "Contract drift" },
  { path: "src/webhooks/github.ts", kind: "missing", risk: "high", note: "No sibling test" },
  { path: "src/api/users.ts", kind: "missing", risk: "medium", note: "No sibling test" },
  { path: "src/runtime/cache.ts", kind: "coverage", risk: "medium", note: "41% covered" },
  { path: "src/auth/tokens.ts", kind: "missing", risk: "medium", note: "No sibling test" },
  { path: "src/queue/retry.ts", kind: "coverage", risk: "medium", note: "58% covered" },
  { path: "src/lib/headers.ts", kind: "missing", risk: "low", note: "No sibling test" },
  { path: "src/lib/time.ts", kind: "missing", risk: "low", note: "No sibling test" },
  { path: "src/routes/health.ts", kind: "missing", risk: "low", note: "No sibling test" },
  { path: "src/routes/openapi.ts", kind: "missing", risk: "low", note: "No sibling test" },
  { path: "src/lib/base64.ts", kind: "missing", risk: "low", note: "No sibling test" },
  { path: "src/workers/edge.ts", kind: "missing", risk: "low", note: "No sibling test" },
];

export interface DraftEndpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  http: number;
  ms: number;
  /** The baseline status, when the test was corrected and now passes. */
  firstHttp?: number;
  outcome?: "fixed" | "skipped";
  note?: string;
}

export const ENDPOINTS: DraftEndpoint[] = [
  { method: "GET", path: "/api/v1/users", http: 200, ms: 41 },
  { method: "POST", path: "/api/v1/users", http: 201, ms: 88 },
  { method: "GET", path: "/api/v1/users/{id}", http: 200, ms: 33 },
  { method: "PATCH", path: "/api/v1/users/{id}", http: 200, ms: 64 },
  { method: "DELETE", path: "/api/v1/users/{id}", http: 204, ms: 52 },
  { method: "GET", path: "/api/v1/projects", http: 200, ms: 47 },
  { method: "POST", path: "/api/v1/projects", http: 201, ms: 91 },
  { method: "GET", path: "/api/v1/keys", http: 200, ms: 29 },
  { method: "POST", path: "/api/v1/keys", http: 201, ms: 73 },
  { method: "GET", path: "/api/v1/sync", http: 200, ms: 38 },
  {
    method: "POST",
    path: "/api/v1/sync",
    http: 200,
    firstHttp: 500,
    ms: 412,
    outcome: "fixed",
    note: "Contract sent a string body; the test now sends JSON. The app was not modified.",
  },
  {
    method: "GET",
    path: "/api/v1/audit",
    http: 401,
    ms: 12,
    outcome: "skipped",
    note: "Security scheme needs a token fixture; skipped, not passed.",
  },
  { method: "GET", path: "/api/v1/health", http: 200, ms: 8 },
  { method: "GET", path: "/api/v1/openapi.json", http: 200, ms: 18 },
];

export const LOG_LINES: Array<{
  level: "info" | "ai" | "warn" | "success" | "error";
  text: string;
}> = [
  { level: "info", text: "cloned acme/edge-api@main · 2,140 files" },
  { level: "success", text: "AST parsed · 318 source files, 204 tests" },
  { level: "warn", text: "14 gaps · 11 missing tests, 2 coverage, 1 api" },
  { level: "ai", text: "writing test for src/auth/session.ts (1/14)" },
  { level: "ai", text: "writing test for src/edge/middleware.ts (2/14)" },
  { level: "warn", text: "POST /api/v1/sync → 500 · contract test corrected" },
  { level: "success", text: "GET /api/v1/audit → skipped · no token fixture" },
  { level: "success", text: "12/14 endpoints passed · 1 fixed · 1 skipped" },
  { level: "success", text: "8 tests ready for review" },
];

export const DIFF: string[] = [
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
];

export const FILES = ["src/auth/session.ts", "src/edge/middleware.ts", "src/api/sync.ts"];
