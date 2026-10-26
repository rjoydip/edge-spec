import { describe, expect, it } from "bun:test";
import { fixtureFor, fixtureKey, parseFixtureFile } from "../src/fixtures";

const FILE = JSON.stringify({
  version: 1,
  recordedAt: "2026-10-26T00:00:00Z",
  exchanges: [
    {
      method: "get",
      path: "/users?limit=1",
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"users":[]}',
    },
    { method: "POST", path: "/users", status: 201, body: "{}" },
    { method: "GET", path: "", status: 500 },
    { method: "GET", path: "/broken", status: "nope" },
  ],
});

describe("fixtureKey", () => {
  it("normalizes the method", () => {
    expect(fixtureKey("get", "/users")).toBe("GET /users");
  });
});

describe("parseFixtureFile", () => {
  it("keeps valid exchanges and drops malformed ones", () => {
    const fixtures = parseFixtureFile(FILE);
    expect(fixtures?.exchanges).toHaveLength(2);
    expect(fixtures?.exchanges[0]).toMatchObject({
      method: "GET",
      path: "/users?limit=1",
      status: 200,
    });
  });

  it("rejects non-JSON and files with no usable exchange", () => {
    expect(parseFixtureFile("not json")).toBeUndefined();
    expect(parseFixtureFile(JSON.stringify({ exchanges: [] }))).toBeUndefined();
  });

  it("finds an exchange by method and exact path", () => {
    const fixtures = parseFixtureFile(FILE);
    if (!fixtures) throw new Error("fixture did not parse");
    expect(fixtureFor(fixtures, "GET", "/users?limit=1")?.status).toBe(200);
    expect(fixtureFor(fixtures, "GET", "/users")).toBeUndefined();
  });
});
