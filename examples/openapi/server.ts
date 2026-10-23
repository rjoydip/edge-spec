import { Hono } from "hono";
import spec from "./openapi.json";

const PETS: Record<string, { id: string; name: string }> = {
  "1": { id: "1", name: "Ada" },
};

export const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/pets/:id", (c) => {
  const pet = PETS[c.req.param("id")];
  return pet ? c.json(pet) : c.json({ error: "not found" }, 404);
});

app.get("/openapi.json", (c) => c.json(spec));
