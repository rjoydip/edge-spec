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
            Limit: {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
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
        paths: {
          "/ping": { get: { responses: { "200": { description: "ok" } } } },
        },
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
        operation: {
          method: "GET",
          path: "/users/{id}",
          operationId: "getUser",
        },
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
    expect(results[0]).toMatchObject({
      method: "GET",
      path: "/users",
      status: "passed",
    });
    expect(results[1]).toMatchObject({
      status: "failed",
      durationMs: 500,
      error: "expected 201, got 500",
    });
    expect(results[2]?.status).toBe("skipped");
  });

  it("names the failure and keeps expected against actual", () => {
    const xml = [
      '<testcase name="GET /users"><failure message="expect(received).toBe(expected)">',
      "Expected: 201\nReceived: 500",
      "</failure></testcase>",
      '<testcase name="POST /users"><failure message="fetch failed: ECONNREFUSED"/></testcase>',
      '<testcase name="DELETE /users"><failure message="Timeout: test exceeded 5000ms"/></testcase>',
      '<testcase name="PUT /users"><failure message="missing token fixture"/></testcase>',
    ].join("");
    const [assertion, boot, timeout, fixture] = parseJUnit(xml);
    expect(assertion).toMatchObject({
      diagnosis: "assertion",
      expected: "201",
      actual: "500",
    });
    expect(boot?.diagnosis).toBe("boot");
    expect(timeout?.diagnosis).toBe("timeout");
    expect(fixture?.diagnosis).toBe("missing-fixture");
  });
});

describe("contractTestsFor", () => {
  const NEGATIVE_SPEC = JSON.stringify({
    openapi: "3.0.0",
    info: { title: "Users", version: "1" },
    servers: [{ url: "https://api.example.test" }],
    paths: {
      "/users": {
        post: {
          security: [{ bearer: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: { email: { type: "string" } },
                  example: { email: "test@example.test" },
                },
              },
            },
          },
          responses: {
            "201": { description: "ok" },
            "400": { description: "bad" },
          },
        },
      },
    },
  });

  it("skips a secured operation until a fixture exists", () => {
    const spec = parseOpenApiSpec(NEGATIVE_SPEC, "openapi.json");
    if (!spec) throw new Error("fixture did not parse");
    const contract = contractTestsFor(spec);
    expect(contract.skipped[0]?.reason).toContain("auth fixture");
    expect(contract.code).toContain("it.skip");
  });

  it("reads fixtures from sandbox env and adds negative cases", () => {
    const spec = parseOpenApiSpec(NEGATIVE_SPEC, "openapi.json");
    if (!spec) throw new Error("fixture did not parse");
    const contract = contractTestsFor(spec, undefined, { auth: true });
    expect(contract.code).not.toContain("it.skip");
    expect(contract.code).toContain("EDGESPEC_AUTH_HEADERS");
    expect(contract.code).toContain("EDGESPEC_AUTH_QUERY");
    expect(contract.code).toContain("unauthorized");
    expect(contract.code).toContain("missing");
    expect(contract.code).toContain("wrongType");
    // Fixtures are env only; no credential value enters the generated file.
    expect(contract.code).not.toContain("Bearer");
  });

  it("can disable negative cases", () => {
    const spec = parseOpenApiSpec(NEGATIVE_SPEC, "openapi.json");
    if (!spec) throw new Error("fixture did not parse");
    const contract = contractTestsFor(spec, undefined, {
      auth: true,
      negative: false,
    });
    expect(contract.code).not.toContain("unauthorized");
    expect(contract.code).not.toContain("wrongType");
  });

  it("embeds a replay mock and a record hook, with no fixture values", () => {
    const spec = parseOpenApiSpec(NEGATIVE_SPEC, "openapi.json");
    if (!spec) throw new Error("fixture did not parse");
    const contract = contractTestsFor(spec, undefined, { auth: true });
    expect(contract.code).toContain('envJson("EDGESPEC_FIXTURES")');
    expect(contract.code).toContain("Bun.serve");
    expect(contract.code).toContain("EDGESPEC_RECORD_FILE");
    expect(contract.code).toContain("if (!REPLAY)");
    // Recorded values are env/file only; no credential is baked in.
    expect(contract.code).not.toContain("Bearer");
  });

  it("can hold only the operations a retest asks for", () => {
    const spec = parseOpenApiSpec(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Small", version: "1" },
        paths: {
          "/a": { get: { responses: { "200": { description: "ok" } } } },
          "/b": { post: { responses: { "201": { description: "ok" } } } },
        },
      }),
      "openapi.json",
    );
    if (!spec) throw new Error("fixture did not parse");
    const contract = contractTestsFor(spec, (operation) => operation.method === "POST");
    expect(contract.operations.map((operation) => operation.method)).toEqual(["POST"]);
    expect(contract.code).toContain("POST /b");
    expect(contract.code).not.toContain("GET /a");
  });
});
