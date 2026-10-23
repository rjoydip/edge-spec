import { describe, expect, test } from "bun:test";
import request from "supertest";
import { app } from "../app";

describe("express app", () => {
  test("returns hello", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "hello from express" });
  });

  test("echoes a name", async () => {
    const response = await request(app).post("/echo").send({ name: "Ada" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ name: "Ada" });
  });

  test("rejects a missing name", async () => {
    const response = await request(app).post("/echo").send({});
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "name is required" });
  });
});
