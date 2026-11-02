/**
 * User authentication via Better Auth, over the runtime SQL port.
 *
 * Email + password with verification and reset. Account records live in SQL
 * (`user`, `session`, `account`, `verification`); the deployment stores no
 * secrets beyond the auth rows better-auth writes (scrypt password hashes).
 * Transactional email reuses the Resend sender: the browser sends
 * `x-email-key` / `x-email-from` with the auth request, so a deployment needs
 * no email configuration of its own unless it sets `EMAIL_API_KEY`.
 */
import { betterAuth } from "better-auth";
import type { Env } from "./env";
import { emailConfigOf, resetPasswordHtml, sendEmail, verifyEmailHtml } from "./email";
import { sqlAuthAdapter } from "./auth-adapter";

/** One Better Auth instance per platform env (bindings are per deployment). */
const instances = new WeakMap<Env, ReturnType<typeof betterAuth>>();

export function authFor(env: Env): ReturnType<typeof betterAuth> {
  const cached = instances.get(env);
  if (cached) return cached;
  const db = env.DB;
  if (!db) throw new Error("Accounts need a database.");

  // Canonical origin: set BETTER_AUTH_URL (or EDGESPEC_WORKSPACE_URL) to
  // silence Better Auth's per-request inference warning and get stable links.
  const baseUrl = (env.EDGESPEC_WORKSPACE_URL ?? env.BETTER_AUTH_URL)?.trim();
  const loopback =
    !baseUrl || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(baseUrl);
  const configuredOrigins = (env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  // The dashboard runs on Vite's localhost origin and proxies /api to the
  // Worker; the browser Origin never becomes 127.0.0.1, so trust both.
  const localOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
  ];

  const auth = betterAuth({
    appName: "EdgeSpec",
    basePath: "/api/auth",
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    trustedOrigins: [
      ...(loopback ? localOrigins : []),
      ...(baseUrl ? [baseUrl] : []),
      ...configuredOrigins,
    ],
    ...(env.BETTER_AUTH_SECRET?.trim() ? { secret: env.BETTER_AUTH_SECRET.trim() } : {}),
    database: sqlAuthAdapter(db),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      // Verification is optional: a deployment without an email sender still
      // signs users in and reports `emailVerified: false` honestly.
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }, request) => {
        const config = emailConfigOf(env, request?.headers);
        if (!config) return;
        void sendEmail(config, {
          to: user.email,
          subject: "Reset your EdgeSpec password",
          html: resetPasswordHtml(url),
        }).catch(() => undefined);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }, request) => {
        const config = emailConfigOf(env, request?.headers);
        if (!config) return;
        void sendEmail(config, {
          to: user.email,
          subject: "Confirm your EdgeSpec email",
          html: verifyEmailHtml(url),
        }).catch(() => undefined);
      },
    },
    // Local HTTP (Docker on localhost) needs a non-Secure cookie; production
    // keeps the default Secure flag from Better Auth.
    ...(/^(1|true)$/i.test(env.EDGESPEC_INSECURE_COOKIES ?? "")
      ? { advanced: { useSecureCookies: false } }
      : {}),
  } as Parameters<typeof betterAuth>[0]);
  instances.set(env, auth);
  return auth;
}
