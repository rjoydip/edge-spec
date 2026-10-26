-- Scheduled drift scans and the snapshot each repository is compared against.
CREATE TABLE IF NOT EXISTS drift_snapshots (
  repo TEXT PRIMARY KEY,
  missing_json TEXT NOT NULL,
  operations_json TEXT NOT NULL,
  scanned_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_repos (
  repo TEXT PRIMARY KEY,
  interval_days INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  installation_id INTEGER,
  last_run_at INTEGER
);
