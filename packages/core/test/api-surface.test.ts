import { describe, expect, it } from "bun:test";
import {
  apiHealthMatrix,
  apiSourceCandidates,
  detectApiFramework,
  extractRoutes,
  inferApiSpec,
  openApiPath,
} from "../src/api-surface";
import { apiGaps } from "../src/openapi";

describe("API surface inference", () => {
  it("infers Hono routes and marks the document", () => {
    const source = [
      'import { Hono } from "hono";',
      "const app = new Hono();",
      'app.get("/health", (c) => c.json({ ok: true }));',
      'app.post("/users/:id", (c) => c.json({ id: c.req.param("id") }));',
      'app.on("GET", "/teams", (c) => c.text("teams"));',
    ].join("\n");
    const inferred = inferApiSpec({
      title: "acme/api",
      paths: ["src/index.ts"],
      files: [{ path: "src/index.ts", content: source }],
      packageJson: JSON.stringify({ dependencies: { hono: "^4" } }),
    });

    expect(inferred?.framework).toBe("Hono");
    expect(inferred?.spec.inferred).toBe(true);
    expect(
      inferred?.spec.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
    ).toEqual(["GET /health", "GET /teams", "POST /users/{id}"]);
    expect(inferred?.spec.endpoints[2]?.parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ]);
    expect(inferred?.spec.content).toContain("x-edgespec-inferred");
    expect(apiGaps([inferred!.spec])[0]?.reason).toContain("inferred");
  });

  it("reads Express and Elysia route calls", () => {
    const routes = extractRoutes([
      {
        path: "src/server.ts",
        content: [
          'import express from "express";',
          'router.get("/users/:id", handler);',
          'const app = new Elysia().put("/pets/:petId", handler);',
        ].join("\n"),
      },
    ]);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "PUT /pets/{petId}",
      "GET /users/{id}",
    ]);
    expect(routes[0]?.source).toBe("src/server.ts");
  });

  it("reads Next.js route files", () => {
    const routes = extractRoutes([
      {
        path: "app/api/orders/[id]/route.ts",
        content: "export async function GET() {}\nexport async function DELETE() {}",
      },
    ]);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "DELETE /orders/{id}",
      "GET /orders/{id}",
    ]);
  });

  it("does not invent a spec without routes", () => {
    expect(
      inferApiSpec({
        title: "acme/ui",
        paths: ["src/App.tsx"],
        files: [{ path: "src/App.tsx", content: "export const App = () => null;" }],
        packageJson: JSON.stringify({ dependencies: { react: "^19" } }),
      }),
    ).toBeUndefined();
  });

  it("detects frameworks from imports and bounds the read set", () => {
    const candidates = apiSourceCandidates([
      "src/App.tsx",
      "src/server.ts",
      "src/lib/format.ts",
      "node_modules/x/index.ts",
    ]);
    expect(candidates).toContain("src/server.ts");
    expect(candidates).not.toContain("node_modules/x/index.ts");
    expect(
      detectApiFramework({
        files: [{ path: "src/a.ts", content: 'import { Hono } from "hono";' }],
      }),
    ).toBe("Hono");
  });

  it("normalizes parameters and reports matrix status", () => {
    expect(openApiPath("/users/:id/")).toBe("/users/{id}");
    const spec = inferApiSpec({
      title: "acme/api",
      paths: ["src/a.ts"],
      files: [{ path: "src/a.ts", content: 'app.get("/health", () => null);' }],
    })!.spec;
    expect(apiHealthMatrix([spec])[0]).toMatchObject({
      method: "GET",
      path: "/health",
      inferred: true,
      status: "missing-test",
    });
    expect(apiHealthMatrix([spec], ["GET /health"])[0]?.status).toBe("covered");
  });
});
