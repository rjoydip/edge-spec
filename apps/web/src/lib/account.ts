/**
 * Account API for the dashboard. Better Auth owns `/api/auth/*`; this module
 * only adapts its JSON to the dashboard's small surface.
 */
import { requestHeaders } from "./settings";

export interface AccountUser {
  id: string;
  email: string;
  name?: string;
  image?: string | null;
  plan?: string;
  emailVerified?: boolean;
  createdAt?: string | number;
}

export interface AccountState {
  /** The deployment has a database, so accounts are available. */
  enabled: boolean;
  user: AccountUser | null;
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    const value = parsed.error ?? parsed.message;
    if (typeof value === "string") return value;
  } catch {
    // Not JSON.
  }
  return text.slice(0, 400) || `Request failed (${response.status}).`;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { ...requestHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json().catch(() => ({}))) as T;
}

/** Better Auth's get-session; `null` means signed out, 501 means no database. */
export async function fetchAccount(): Promise<AccountState> {
  try {
    const response = await fetch("/api/auth/get-session", {
      headers: { ...requestHeaders() },
    });
    if (response.status === 501) return { enabled: false, user: null };
    if (!response.ok) return { enabled: true, user: null };
    const body = (await response.json()) as { user?: AccountUser } | null;
    return { enabled: true, user: body?.user ?? null };
  } catch {
    return { enabled: false, user: null };
  }
}

export async function signUp(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ user: AccountUser }> {
  const result = await post<{ user?: AccountUser }>("/api/auth/sign-up/email", {
    ...input,
    callbackURL: "/",
  });
  if (!result.user) throw new Error("Sign-up did not return a user.");
  return { user: result.user };
}

export async function signIn(email: string, password: string): Promise<{ user: AccountUser }> {
  const result = await post<{ user?: AccountUser }>("/api/auth/sign-in/email", {
    email,
    password,
    rememberMe: true,
  });
  if (!result.user) throw new Error("Sign-in did not return a user.");
  return { user: result.user };
}

/** Better Auth's update-user: name and avatar only (plan is server-owned). */
export async function updateProfile(input: {
  name: string;
  image?: string | null;
}): Promise<AccountUser> {
  await post("/api/auth/update-user", input);
  const state = await fetchAccount();
  if (!state.user) throw new Error("Profile saved, but the session could not be refreshed.");
  return state.user;
}

export async function signOut(): Promise<void> {
  await post("/api/auth/sign-out", {});
}

export async function requestPasswordReset(email: string): Promise<{ delivered: boolean }> {
  await post("/api/auth/request-password-reset", {
    email,
    redirectTo: "/reset-password",
  });
  // Better Auth answers the same whether or not the address exists.
  return { delivered: true };
}

export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  await post("/api/auth/reset-password", { token, newPassword: password });
}

/** Better Auth verifies through its own endpoint; the page forwards the token. */
export async function verifyEmail(token: string): Promise<void> {
  const response = await fetch(
    `/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=/login`,
    { headers: { ...requestHeaders() } },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
}
