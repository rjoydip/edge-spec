/**
 * Local credential store for the CLI and MCP server: the file equivalent of
 * the dashboard's localStorage settings (settings travel per request here
 * too — the stored profile only fills request-header values).
 *
 * One file per user, not per repository: keys must never be committed. The
 * loader is tolerant — a missing or unreadable file means "not logged in".
 *
 *   ponytail: chmod 0600 except Windows (user-profile ACL is the default);
 *   if multi-agent hardening is needed, wrap with the OS keychain via
 *   `@edge-spec/core` later.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AuthFile {
  workspace: string;
  token: string;
  authorizedAt: number;
  /** The approved settings, in exactly the shape `defaultsWithCredentials` merges. */
  profile: {
    githubToken?: string;
    aiKey?: string;
    aiBaseUrl?: string;
    sandboxUrl?: string;
    sandboxKey?: string;
    sandboxConfig?: string;
    provider?: string;
    model?: string;
    accountId?: string;
  };
}

export const credentialsPath = (home = homedir()): string => join(home, ".edgespec", "auth.json");

export const readCredentials = (home?: string): AuthFile | undefined => {
  try {
    const raw = readFileSync(credentialsPath(home), "utf8");
    const parsed = JSON.parse(raw) as Partial<AuthFile>;
    if (typeof parsed.token !== "string" || typeof parsed.workspace !== "string") return undefined;
    return parsed as AuthFile;
  } catch {
    return undefined;
  }
};

export const writeCredentials = (auth: AuthFile, home?: string): void => {
  const path = credentialsPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(auth, null, 2)}\n`);
  if (process.platform !== "win32") {
    try {
      // The file holds user-provided secrets; owner-only on platforms that
      // support the mode bits.
      const { chmodSync } = require("node:fs") as typeof import("node:fs");
      chmodSync(path, 0o600);
    } catch {
      // Best effort; the user-profile directory is already restrictive.
    }
  }
};

export const clearCredentials = (home?: string): void => {
  const path = credentialsPath(home);
  if (existsSync(path)) rmSync(path, { force: true });
};

// ---------------------------------------------------------------------------
// A login still in flight (device code + payload key) and binding secrets to
// the environment, shared by the CLI and MCP server.

export interface PendingAuth {
  deviceCode: string;
  userCode: string;
  workspace: string;
  /** Only the CLI host holds this: it decrypts the approved profile locally. */
  payloadKey: string;
  startedAt: number;
}

const pendingPath = (home = homedir()): string => join(home, ".edgespec", "auth-pending.json");

export const readPendingAuth = (): PendingAuth | undefined => {
  try {
    const parsed = JSON.parse(readFileSync(pendingPath(), "utf8")) as Partial<PendingAuth>;
    if (
      typeof parsed.deviceCode !== "string" ||
      typeof parsed.userCode !== "string" ||
      typeof parsed.payloadKey !== "string"
    ) {
      return undefined;
    }
    return parsed as PendingAuth;
  } catch {
    return undefined;
  }
};

export const writePendingAuth = (pending: PendingAuth): void => {
  const path = pendingPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(pending, null, 2)}\n`);
};

export const clearPendingAuth = (): void => {
  const path = pendingPath();
  if (existsSync(path)) rmSync(path, { force: true });
};

/**
 * Merge a logged-in profile under the process environment: the profile fills
 * request-header values for every key the shell leaves empty, and the shell
 * always wins where it speaks.
 */
export const effectiveEnv = (
  env: Record<string, string | undefined>,
  stored: AuthFile | undefined = readCredentials(),
): Record<string, string | undefined> => {
  if (!stored) return env;
  const profile = stored.profile;
  const filled = (current: string | undefined, next?: string): string | undefined =>
    current?.trim() || next?.trim() || undefined;
  return {
    ...env,
    EDGESPEC_URL: filled(env.EDGESPEC_URL, stored.workspace),
    GH_TOKEN: filled(env.GH_TOKEN, profile.githubToken),
    GITHUB_TOKEN: filled(env.GITHUB_TOKEN, profile.githubToken),
    EDGESPEC_AI_KEY: filled(env.EDGESPEC_AI_KEY, profile.aiKey),
    EDGESPEC_AI_BASE_URL: filled(env.EDGESPEC_AI_BASE_URL, profile.aiBaseUrl),
    EDGESPEC_SANDBOX_URL: filled(env.EDGESPEC_SANDBOX_URL, profile.sandboxUrl),
    EDGESPEC_SANDBOX_KEY: filled(env.EDGESPEC_SANDBOX_KEY, profile.sandboxKey),
    EDGESPEC_SANDBOX_CONFIG: filled(env.EDGESPEC_SANDBOX_CONFIG, profile.sandboxConfig),
    EDGESPEC_AI_PROVIDER: filled(env.EDGESPEC_AI_PROVIDER, profile.provider),
    EDGESPEC_AI_MODEL: filled(env.EDGESPEC_AI_MODEL, profile.model),
    CLOUDFLARE_ACCOUNT_ID: filled(env.CLOUDFLARE_ACCOUNT_ID, profile.accountId),
  };
};
