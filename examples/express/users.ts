import { Router } from "express";

export const users = Router();

users.get("/users", (_req, res) => {
  res.json([{ id: "ada" }]);
});

users.get("/users/:id", (req, res) => {
  res.json({ id: req.params.id });
});
