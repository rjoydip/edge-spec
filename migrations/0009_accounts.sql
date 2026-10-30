-- Accounts. Email and the bcrypt-style hash are stored; secrets never are.
-- The plan column is filled by the admin activation endpoint (no gateway yet).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- One session per browser or client library; only a SHA-256 of the token is
-- stored, so a database dump cannot replay a session.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Single-use email tokens: verify-address and password reset. Hashed like
-- sessions; kind carries the purpose; used_at marks consumption.
CREATE TABLE IF NOT EXISTS account_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
