-- Better Auth accounts (email + password), forward migration.
--
-- The previous accounts tables (`users`/`sessions`/`account_tokens`) are
-- replaced by Better Auth's core schema. They were created by 0009, which no
-- deployment applied before this migration existed; the drops are no-ops on a
-- fresh database and clean up local development state.
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  id TEXT PRIMARY KEY,
  "expiresAt" TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS session_user ON "session" ("userId");
CREATE INDEX IF NOT EXISTS session_token ON "session" (token);

CREATE TABLE IF NOT EXISTS "account" (
  id TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TEXT,
  "refreshTokenExpiresAt" TEXT,
  scope TEXT,
  password TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_user ON "account" ("userId");

CREATE TABLE IF NOT EXISTS "verification" (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS verification_identifier ON "verification" (identifier);

DROP TABLE IF EXISTS account_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
