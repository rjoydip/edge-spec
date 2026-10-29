/** Account API for the dashboard: /api/auth/* plus the session cache. */
import { requestHeaders } from "./settings";

export interface AccountUser {
  id: string;
  email: string;
  name?: string;
  plan: string;
  emailVerified: boolean;
  createdAt: number;
}

export interface AccountState {
  /** The deployment's database exists, so accounts route exists. */
  enabled: boolean;
  user: AccountUser | null;
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // Not JSON.
  }
  return text.slice(0, 400) || `Request failed (${response.status}).`;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { ...requestHeaders() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await post(path, body);
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

export async function fetchAccount(): Promise<AccountState> {
  try {
    const response = await fetch("/api/auth/me", { headers: { ...requestHeaders() } });
    if (response.status === 404) return { enabled: false, user: null };
    const body = (await response.json()) as Partial<AccountState>;
    if (!body.enabled) return { enabled: false, user: null };
    return { enabled: true, user: body.user ?? null };
  } catch {
    return { enabled: false, user: null };
  }
}

export async function signUp(input: { email: string; password: string; name?: string }): Promise<{
  user: AccountUser;
  emailNote?: string;
}> {
  return postJson("/api/auth/signup", input);
}

export async function signIn(email: string, password: string): Promise<{ user: AccountUser }> {
  return postJson("/api/auth/login", { email, password });
}

export async function signOut(): Promise<void> {
  await post("/api/auth/logout", undefined);
}

export async function verifyEmail(token: string): Promise<void> {
  await postJson("/api/auth/verify-email", { token });
}

export async function requestPasswordReset(email: string): Promise<{ delivered: boolean }> {
  return postJson("/api/auth/password-reset", { email });
}

export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  await postJson("/api/auth/password-reset/confirm", { token, password });
}
