import { describe, expect, test } from "bun:test";
import request from "supertest";
import { app } from "../app";

describe("mounted users router", () => {
  test("lists users under /api", async () => {
    const response = await request(app).get("/api/users");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: "ada" }]);
  });

  test("reads one user", async () => {
    const response = await request(app).get("/api/users/ada");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: "ada" });
  });
});
