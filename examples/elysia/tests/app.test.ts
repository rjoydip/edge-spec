import { describe, expect, test } from "bun:test";
import { app } from "../app";

function post(body: unknown): Request {
  return new Request("http://localhost/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("elysia app", () => {
  test("returns hello", async () => {
    const response = await app.handle(new Request("http://localhost/"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello from elysia");
  });

  test("echoes a name", async () => {
    const response = await app.handle(post({ name: "Ada" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "Ada" });
  });

  test("rejects an empty name", async () => {
    const response = await app.handle(post({ name: "" }));
    expect(response.status).toBe(422);
  });
});
