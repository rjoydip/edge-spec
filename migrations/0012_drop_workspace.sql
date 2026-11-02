-- The workspace settings feature is gone: audit events belong to the
-- deployment, not to a tenant. Drop the unused table and its legacy column.
DROP INDEX IF EXISTS audit_workspace_created;
DROP TABLE IF EXISTS workspaces;
ALTER TABLE audit_events DROP COLUMN workspace_id;
