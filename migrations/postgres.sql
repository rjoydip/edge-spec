-- PostgreSQL schema for non-Cloudflare targets. Applied by `bun run migrate`.
-- Same tables and columns as migrations/*.sql, translated once so a Postgres
-- deployment does not replay SQLite-only syntax.
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  ref TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  finished_at BIGINT,
  totals_json TEXT NOT NULL,
  cost DOUBLE PRECISION
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

CREATE TABLE IF NOT EXISTS policies (
  repo TEXT PRIMARY KEY,
  policy_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS pr_commands (
  repo TEXT NOT NULL,
  pull INTEGER NOT NULL,
  login TEXT NOT NULL,
  command TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  PRIMARY KEY (repo, pull, login, command)
);

CREATE TABLE IF NOT EXISTS drift_snapshots (
  repo TEXT PRIMARY KEY,
  missing_json TEXT NOT NULL,
  operations_json TEXT NOT NULL,
  scanned_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_repos (
  repo TEXT PRIMARY KEY,
  interval_days INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  installation_id INTEGER,
  last_run_at BIGINT,
  drift_webhook_url TEXT,
  drift_webhook_secret TEXT
);

CREATE TABLE IF NOT EXISTS backlog_items (
  repo TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  owner TEXT,
  risk TEXT,
  reason TEXT,
  first_seen BIGINT NOT NULL,
  last_seen BIGINT NOT NULL,
  closed_at BIGINT,
  last_run_id TEXT,
  PRIMARY KEY (repo, path)
);

CREATE TABLE IF NOT EXISTS repo_memory (
  repo TEXT PRIMARY KEY,
  memory_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  retention_days INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  drift_webhook_url TEXT,
  drift_webhook_secret TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  repo TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_workspace_created ON audit_events (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  email_verified BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);
