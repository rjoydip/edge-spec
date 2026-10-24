import { describe, expect, it } from "bun:test";
import {
  apiGaps,
  contractPathFor,
  contractTestName,
  contractTestsFor,
  parseJUnit,
} from "../src/openapi";
import { parseOpenApiSpec } from "../src/scanner";

const YAML = `
openapi: 3.0.3
info:
  title: Users API
  version: 1.0.0
servers:
  - url: https://api.example.test
paths:
  /users/{id}:
    get:
      operationId: getUser
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: ok
        "404":
          description: missing
`;

describe("parseOpenApiSpec", () => {
  it("parses YAML in the Worker runtime, not only in Bun", () => {
    const spec = parseOpenApiSpec(YAML, "openapi.yaml");
    expect(spec?.title).toBe("Users API");
    expect(spec?.servers).toEqual(["https://api.example.test"]);
    expect(spec?.endpoints).toHaveLength(1);
    expect(spec?.endpoints[0]).toMatchObject({
      method: "GET",
      path: "/users/{id}",
      operationId: "getUser",
      responses: ["200", "404"],
    });
    expect(spec?.endpoints[0]?.parameters?.[0]).toMatchObject({
      name: "id",
      in: "path",
      required: true,
    });
  });

  it("resolves a local $ref and never fetches a remote one", () => {
    const spec = parseOpenApiSpec(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Refs", version: "1" },
        paths: {
          "/x": {
            get: {
              parameters: [{ $ref: "#/components/parameters/Limit" }],
              responses: { "200": { description: "ok" } },
            },
          },
        },
        components: {
          parameters: {
            Limit: { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
          },
        },
      }),
      "openapi.json",
    );
    expect(spec?.endpoints[0]?.parameters?.[0]).toMatchObject({
      name: "limit",
      in: "query",
      default: 10,
    });
  });
});

describe("contract tests", () => {
  const spec = parseOpenApiSpec(YAML, "openapi.yaml");
  if (!spec) throw new Error("fixture did not parse");

  it("names every test METHOD /path and maps a spec to one file", () => {
    expect(contractTestName({ method: "GET", path: "/users/{id}" })).toBe("GET /users/{id}");
    expect(contractPathFor("docs/openapi.yaml")).toBe("tests/api/openapi.contract.test.ts");
  });

  it("substitutes a resolved path parameter and asserts a documented status", () => {
    const contract = contractTestsFor(spec);
    expect(contract.skipped).toHaveLength(0);
    expect(contract.code).toContain('it("GET /users/{id}"');
    expect(contract.code).toContain("/users/1");
    expect(contract.code).toContain("process.env.BASE_URL");
    expect(contract.code).toContain("[200,404]");
  });

  it("skips an operation whose required parameter has no value instead of inventing one", () => {
    const unresolved = parseOpenApiSpec(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Unresolved", version: "1" },
        servers: [{ url: "https://api.example.test" }],
        paths: {
          "/things/{id}": {
            get: {
              parameters: [{ name: "id", in: "path", required: true, schema: {} }],
              responses: { "200": { description: "ok" } },
            },
          },
        },
      }),
      "openapi.json",
    );
    if (!unresolved) throw new Error("fixture did not parse");
    const contract = contractTestsFor(unresolved);
    expect(contract.skipped[0]?.reason).toContain("path parameter");
    expect(contract.code).toContain("it.skip");
  });

  it("skips every operation when the spec declares no base URL", () => {
    const noServer = parseOpenApiSpec(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "No server", version: "1" },
        paths: { "/ping": { get: { responses: { "200": { description: "ok" } } } } },
      }),
      "openapi.json",
    );
    if (!noServer) throw new Error("fixture did not parse");
    expect(contractTestsFor(noServer).skipped[0]?.reason).toBe("no base URL");
  });
});

describe("apiGaps", () => {
  it("reports one gap per operation whose test name is missing", () => {
    const spec = parseOpenApiSpec(YAML, "openapi.yaml");
    if (!spec) throw new Error("fixture did not parse");
    const [gap] = apiGaps([spec]);
    expect(gap).toMatchObject({
      kind: "api",
      testPath: "tests/api/openapi.contract.test.ts",
      evidence: {
        specPath: "openapi.yaml",
        operation: { method: "GET", path: "/users/{id}", operationId: "getUser" },
      },
    });
    expect(apiGaps([spec], ["GET /users/{id}"])).toHaveLength(0);
  });
});

describe("parseJUnit", () => {
  it("maps passed, failed and skipped cases back to their operation", () => {
    const xml = [
      '<testsuite name="contract">',
      '<testcase name="GET /users" time="0.25"/>',
      '<testcase name="POST /users" time="0.5"><failure message="expected 201, got 500"/></testcase>',
      '<testcase name="DELETE /users/{id}"><skipped/></testcase>',
      '<testcase name="not an operation"/>',
      "</testsuite>",
    ].join("");
    const results = parseJUnit(xml, "openapi.yaml");
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ method: "GET", path: "/users", status: "passed" });
    expect(results[1]).toMatchObject({
      status: "failed",
      durationMs: 500,
      error: "expected 201, got 500",
    });
    expect(results[2]?.status).toBe("skipped");
  });
});
