-- PR command rate limit. One row per repository, pull request, user and command.
CREATE TABLE IF NOT EXISTS pr_commands (
  repo TEXT NOT NULL,
  pull INTEGER NOT NULL,
  login TEXT NOT NULL,
  command TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (repo, pull, login, command)
);
