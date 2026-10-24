import { describe, expect, test } from "bun:test";
import { app } from "../server";
import spec from "../openapi.yaml";

describe("openapi app", () => {
  test("publishes the documented paths", async () => {
    const response = await app.request("/openapi.json");
    expect(response.status).toBe(200);

    const published = (await response.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(published.openapi).toBe("3.1.0");
    expect(published.paths["/health"]).toBeDefined();
    expect(published.paths["/pets/{id}"]).toBeDefined();
    expect(spec.paths["/pets/{id}"]).toBeDefined();
  });

  test("serves the health check", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("returns a pet or a 404", async () => {
    const found = await app.request("/pets/1");
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ id: "1", name: "Ada" });

    const missing = await app.request("/pets/2");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not found" });
  });
});
