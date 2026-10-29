/**
 * Account routes: signup, login, logout, session, email verification,
 * password reset. Mounted by `app.ts`; see {@link accounts} for the storage
 * and hashing model and {@link email} for the sender.
 *
 * Requests carry the email sender the way every other visitor-supplied
 * integration does: `x-email-key` (Resend) and `x-email-from` headers from
 * the browser's settings, with deployment env as the fallback.
 */
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { isPlanId } from "@edge-spec/core/plans";
import type { Env } from "./env";
import {
  countUsers,
  createSession,
  createUser,
  deleteSession,
  hashPassword,
  issueAccountToken,
  markEmailVerified,
  redeemAccountToken,
  sessionUser,
  setPassword,
  setPlan,
  userByEmail,
  userById,
  verifyPassword,
  type AccountUser,
} from "./accounts";
import { emailConfigOf, resetPasswordHtml, sendEmail, verifyEmailHtml } from "./email";

export const SESSION_COOKIE = "edgespec_session";
/** `sameSite=lax`: the dashboard is same-origin, the CLI sends header tokens. */
const COOKIE_OPTS = { path: "/", httpOnly: true, sameSite: "Lax", secure: true } as const;

export const SESSION_HEADER = "x-session-token";

const emailOf = (c: Context): string => {
  const value = (c.req.header("x-email-from") ?? "").trim();
  return value;
};

const workspaceOf = (c: Context): string =>
  c.env.EDGESPEC_WORKSPACE_URL?.trim() ||
  emailOf(c).replace(/^\.+/, "").trim() ||
  new URL(c.req.url).origin;

const bearer = (c: Context): string =>
  c.req.header(SESSION_HEADER)?.trim() ||
  c.req
    .header("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim() ||
  getCookie(c, SESSION_COOKIE) ||
  "";

const publicUser = (user: AccountUser) => ({
  id: user.id,
  email: user.email,
  ...(user.name ? { name: user.name } : {}),
  plan: user.plan,
  emailVerified: user.emailVerified,
  createdAt: user.createdAt,
});

const str = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === "string" ? (body[key] as string).trim() : "";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const dbOf = (c: Context): Env["DB"] => (c.env as Env).DB;

export function accountRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/api/auth/signup", async (c) => {
    const db = dbOf(c);
    if (!db) return c.json({ error: "Accounts need a database. Bind one first." }, 501);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = str(body, "email").toLowerCase();
    const password = str(body, "password");
    const name = str(body, "name");
    if (!EMAIL_RE.test(email)) return c.json({ error: "Enter a valid email address." }, 400);
    return signup(c, email, password, name);
  });

  async function signup(
    c: Context,
    email: string,
    password: string,
    name: string,
  ): Promise<Response> {
    const db = c.env.DB;
    if (!db) return c.json({ error: "Accounts need a database. Bind one first." }, 501);
    if (password.length < 8) {
      return c.json({ error: "Passwords need at least 8 characters." }, 400);
    }
    if (await userByEmail(db, email)) {
      // Same answer whether it exists or not: signup is not an oracle.
      return c.json({ error: "That email already has an account. Sign in instead." }, 409);
    }
    // The first account bootstraps to the admin plan, so there is a way to
    // grant plans before any admin endpoint could ever be called.
    const isFirstAccount = Boolean(c.env.ADMIN_KEY?.trim()) && (await countUsers(db)) === 0;
    const created = await createUser(db, { email, password, name });
    const plan = isFirstAccount ? "team" : "free";
    if (plan !== "free") await setPlan(db, created.user.id, plan);
    const config = emailConfigOf(c.env, c);
    let verifiedHint: string | undefined;
    if (config) {
      const token = await issueAccountToken(db, created.user.id, "verify-email");
      const sent = await sendEmail(config, {
        to: created.user.email,
        subject: "Confirm your EdgeSpec email",
        html: verifyEmailHtml(workspaceOf(c), token),
      });
      if (!sent.sent) verifiedHint = sent.reason;
    } else {
      verifiedHint = "No email sender is configured yet — ask the admin to verify.";
    }
    const session = await createSession(db, created.user.id);
    setCookie(c, SESSION_COOKIE, session.token, COOKIE_OPTS);
    return c.json(
      {
        user: publicUser({ ...created.user, plan }),
        ...(verifiedHint ? { emailNote: verifiedHint } : {}),
      },
      201,
    );
  }

  app.post("/api/auth/login", async (c) => {
    const db = dbOf(c);
    if (!db) return c.json({ error: "Accounts need a database. Bind one first." }, 501);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = str(body, "email").toLowerCase();
    const password = str(body, "password");
    const user = await userByEmail(db, email);
    if (!user) return c.json({ error: "Email or password is wrong." }, 401);
    const row = await db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ password_hash: string }>();
    const ok = row ? await verifyPassword(row.password_hash, password) : false;
    if (!ok) return c.json({ error: "Email or password is wrong." }, 401);
    const session = await createSession(db, user.id);
    setCookie(c, SESSION_COOKIE, session.token, COOKIE_OPTS);
    return c.json({ user: publicUser(user) });
  });

  app.post("/api/auth/logout", async (c) => {
    const token = bearer(c);
    const db = dbOf(c);
    if (token && db) await deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: COOKIE_OPTS.path });
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", async (c) => {
    const db = dbOf(c);
    if (!db) return c.json({ enabled: false }, 200);
    const user = await sessionUser(db, bearer(c));
    if (!user) return c.json({ enabled: true, user: null }, 401);
    return c.json({ enabled: true, user: publicUser(user) });
  });

  app.post("/api/auth/verify-email", async (c) => {
    const db = dbOf(c);
    if (!db) return c.json({ error: "Accounts need a database." }, 501);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const token = str(body, "token") || new URL(c.req.url).searchParams.get("token") || "";
    const redeemed = token ? await redeemAccountToken(db, token, "verify-email") : undefined;
    if (!redeemed) return c.json({ error: "That token is unknown, used or expired." }, 400);
    await markEmailVerified(db, redeemed.user.id);
    return c.json({ ok: true });
  });

  /**
   * Forgot password. Always `ok`: the answer never reveals whether the email
   * has an account. The reset link only goes out when a sender is configured.
   */
  app.post("/api/auth/password-reset", async (c) => {
    const db = dbOf(c);
    if (!db) return c.json({ ok: true, delivered: false });
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = str(body, "email").toLowerCase();
    const user = EMAIL_RE.test(email) ? await userByEmail(db, email) : undefined;
    if (user) {
      const config = emailConfigOf(c.env as Env, c);
      if (config) {
        const token = await issueAccountToken(db, user.id, "reset-password");
        await sendEmail(config, {
          to: user.email,
          subject: "Reset your EdgeSpec password",
          html: resetPasswordHtml(workspaceOf(c), token),
        });
      }
    }
    return c.json({
      ok: true,
      delivered: Boolean(user && emailConfigOf(c.env as Env, c)),
    });
  });

  app.post("/api/auth/password-reset/confirm", async (c) => {
    const db = dbOf(c);
    if (!db) return c.json({ error: "Accounts need a database." }, 501);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const token = str(body, "token");
    const password = str(body, "password");
    if (password.length < 8) {
      return c.json({ error: "Passwords need at least 8 characters." }, 400);
    }
    const redeemed = await redeemAccountToken(db, token, "reset-password");
    if (!redeemed) return c.json({ error: "That token is unknown, used or expired." }, 400);
    const { user } = redeemed;
    const { stored } = await hashPassword(password);
    await setPassword(db, user.id, stored);
    return c.json({ ok: true });
  });

  // Admin: manual plan activation until a payment gateway exists.
  app.post("/api/admin/plans/activate", async (c) => {
    const db = dbOf(c);
    if (!db) return c.json({ error: "Accounts need a database." }, 501);
    const expected = (c.env as Env).ADMIN_KEY?.trim();
    if (!expected) return c.json({ error: "Not enabled: set ADMIN_KEY." }, 501);
    const given = c.req.header("x-admin-key")?.trim() ?? "";
    if (!sameSecret(given, expected)) return c.json({ error: "Unauthorized." }, 401);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = str(body, "email").toLowerCase();
    const plan = str(body, "plan");
    if (!isPlanId(plan)) return c.json({ error: `Unknown plan "${plan}".` }, 400);
    const user = await userByEmail(db, email);
    if (!user) return c.json({ error: "No account for that email." }, 404);
    await setPlan(db, user.id, plan);
    const updated = await userById(db, user.id);
    return c.json({ ok: true, user: updated ? publicUser(updated) : { email, plan } });
  });

  return app;
}

/** Constant-time-ish comparison for the admin key (mirrors app.ts). */
function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < given.length; index += 1) {
    diff |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}
