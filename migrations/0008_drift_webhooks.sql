-- Per-workspace drift notifications with optional per-repository overrides.
-- The secret is write-only through the API and is never returned to clients.
ALTER TABLE workspaces ADD COLUMN drift_webhook_url TEXT;
ALTER TABLE workspaces ADD COLUMN drift_webhook_secret TEXT;

ALTER TABLE scheduled_repos ADD COLUMN drift_webhook_url TEXT;
ALTER TABLE scheduled_repos ADD COLUMN drift_webhook_secret TEXT;
