-- Per-repository CI policy. Opt-in; no keys, prompts or source text.
CREATE TABLE IF NOT EXISTS policies (
  repo TEXT PRIMARY KEY,
  policy_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
