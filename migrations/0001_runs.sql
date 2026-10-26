-- Run history. No API keys, tokens, prompts or source text are stored here.
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  ref TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  totals_json TEXT NOT NULL,
  cost REAL
);

CREATE INDEX IF NOT EXISTS runs_repo_started ON runs (repo, started_at DESC);

CREATE TABLE IF NOT EXISTS run_files (
  run_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  test_path TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending',
  verified INTEGER NOT NULL DEFAULT 0,
  checks_json TEXT NOT NULL DEFAULT '[]',
  coverage_json TEXT,
  PRIMARY KEY (run_id, source_path)
);
