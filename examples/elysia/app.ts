import { Elysia, t } from "elysia";

export const app = new Elysia()
  .get("/", () => "hello from elysia")
  .post("/echo", ({ body }) => ({ name: body.name }), {
    body: t.Object({ name: t.String({ minLength: 1 }) }),
  });
