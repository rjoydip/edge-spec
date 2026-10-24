import express from "express";

export const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "hello from express" });
});

app.post("/echo", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  res.json({ name });
});
