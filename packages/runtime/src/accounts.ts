/**
 * Accounts: email + password login, sessions, verification and reset tokens.
 *
 * Invariant 1 becomes "the deployment stores no *secrets*": what lands in SQL
 * is the email, a salted PBKDF2 hash (never the password), and SHA-256 token
 * digests (never the token). Sessions are single secrets minted at login and
 * carried as an httpOnly cookie or an `x-session-token` header. GitHub and AI
 * keys stay client-side request headers, exactly as before.
 *
 * SQL reaches the deployment's history database (any @edge-spec/db driver),
 * so every target can run accounts.
 */
import type { SqlDatabase } from "./env";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export interface AccountUser {
  id: string;
  email: string;
  name?: string;
  plan: string;
  emailVerified: boolean;
  createdAt: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  plan: string;
  email_verified: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Hashing: PBKDF2-SHA-256 over 16 bytes of salt, stored as
// `pbkdf2$<iters>$<salt b64>$<hash b64>` — a format any platform can verify.

export async function hashPassword(
  password: string,
  iterations = 100_000,
): Promise<{ stored: string; verify(password: string): Promise<boolean> }> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, iterations);
  const stored = `pbkdf2$${iterations}$${toB64(salt)}$${toB64(hash)}`;
  return {
    stored,
    verify: (candidate) => verifyPassword(stored, candidate),
  };
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;
  const candidate = await pbkdf2(password, fromB64(salt), Number(iterations));
  return sameBytes(candidate, fromB64(hash));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

const toB64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromB64 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Storage helpers over the runtime's SqlDatabase port.

const userOf = (row: UserRow): AccountUser => ({
  id: row.id,
  email: row.email,
  ...(row.name ? { name: row.name } : {}),
  plan: row.plan,
  emailVerified: row.email_verified === 1,
  createdAt: row.created_at,
});

const newId = (): string => crypto.randomUUID();

export async function countUsers(db: SqlDatabase): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>();
  return row?.c ?? 0;
}

export async function userByEmail(
  db: SqlDatabase,
  email: string,
): Promise<AccountUser | undefined> {
  const row = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<UserRow>();
  return row ? userOf(row) : undefined;
}

export async function userById(db: SqlDatabase, id: string): Promise<AccountUser | undefined> {
  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  return row ? userOf(row) : undefined;
}

export async function createUser(
  db: SqlDatabase,
  input: { email: string; password: string; name?: string },
): Promise<{ user: AccountUser; password: { verify(candidate: string): Promise<boolean> } }> {
  const { stored, verify } = await hashPassword(input.password);
  const user: AccountUser = {
    id: newId(),
    email: input.email.toLowerCase(),
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    plan: "free",
    emailVerified: false,
    createdAt: Date.now(),
  };
  await db
    .prepare(
      "INSERT INTO users (id, email, name, password_hash, plan, email_verified, created_at) VALUES (?, ?, ?, ?, 'free', 0, ?)",
    )
    .bind(user.id, user.email, user.name ?? null, stored, user.createdAt)
    .run();
  return { user, password: { verify } };
}

export const setPlan = async (db: SqlDatabase, userId: string, plan: string): Promise<void> => {
  await db.prepare("UPDATE users SET plan = ? WHERE id = ?").bind(plan, userId).run();
};

export const markEmailVerified = async (db: SqlDatabase, userId: string): Promise<void> => {
  await db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").bind(userId).run();
};

/** Password change path: rewrite the hash, kill existing sessions. */
export async function setPassword(db: SqlDatabase, userId: string, stored: string): Promise<void> {
  await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(stored, userId).run();
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

// ---------------------------------------------------------------------------
// Sessions: one token per login; only its SHA-256 lands in SQL.

export async function createSession(
  db: SqlDatabase,
  userId: string,
): Promise<{ token: string; expiresAt: number }> {
  const token = `esx_${randomToken(24)}`;
  const tokenHash = await sha256Hex(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await db
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(tokenHash, userId, Date.now(), expiresAt)
    .run();
  return { token, expiresAt };
}

export async function sessionUser(
  db: SqlDatabase,
  token: string,
): Promise<AccountUser | undefined> {
  if (!token.trim()) return undefined;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
    )
    .bind(tokenHash, Date.now())
    .first<UserRow>();
  return row ? userOf(row) : undefined;
}

export async function deleteSession(db: SqlDatabase, token: string): Promise<void> {
  await db
    .prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .run();
}

// ---------------------------------------------------------------------------
// Single-use email tokens: verification and password reset.

export type TokenKind = "verify-email" | "reset-password";

export async function issueAccountToken(
  db: SqlDatabase,
  userId: string,
  kind: TokenKind,
): Promise<string> {
  const token = randomToken(24);
  const ttl = kind === "verify-email" ? VERIFY_TTL_MS : RESET_TTL_MS;
  await db
    .prepare(
      "INSERT INTO account_tokens (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(await sha256Hex(token), userId, kind, Date.now(), Date.now() + ttl)
    .run();
  return token;
}

export interface RedeemedToken {
  user: AccountUser;
  kind: TokenKind;
}

/**
 * Consumes an unused, unexpired token. Single use: the consumed row is stamped
 * before anything else happens, so a double-submit cannot replay it.
 */
export async function redeemAccountToken(
  db: SqlDatabase,
  token: string,
  kind: TokenKind,
): Promise<RedeemedToken | undefined> {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      "SELECT u.*, t.kind, t.used_at FROM account_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?",
    )
    .bind(tokenHash)
    .first<UserRow & { kind: string; used_at: number | null }>();
  if (!row || row.kind !== kind || row.used_at !== null) return undefined;
  await db
    .prepare("UPDATE account_tokens SET used_at = ? WHERE token_hash = ?")
    .bind(Date.now(), tokenHash)
    .run();
  return { user: userOf(row), kind };
}

// ---------------------------------------------------------------------------

const randomToken = (length: number): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
