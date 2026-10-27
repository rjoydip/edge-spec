import { Hono } from "hono";

export const app = new Hono();

app.get("/", (c) => c.text("hello from hono"));

app.get("/users/:id", (c) => {
  const id = c.req.param("id");
  return c.json({ id });
});
