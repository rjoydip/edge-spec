-- Opt-in repository memory: approved conventions, helpers, fixtures and naming.
CREATE TABLE IF NOT EXISTS repo_memory (
  repo TEXT PRIMARY KEY,
  memory_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
