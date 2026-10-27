-- Durable test-debt backlog. Gaps are upserted by scans; a disappeared gap closes.
CREATE TABLE IF NOT EXISTS backlog_items (
  repo TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  owner TEXT,
  risk TEXT,
  reason TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  closed_at INTEGER,
  last_run_id TEXT,
  PRIMARY KEY (repo, path)
);
