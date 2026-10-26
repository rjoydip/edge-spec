import { describe, expect, test } from "bun:test";
import { app } from "../app";

describe("hono app", () => {
  test("returns plain text on the root route", async () => {
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello from hono");
  });

  test("returns the route parameter as JSON", async () => {
    const response = await app.request("/users/42");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "42" });
  });
});
