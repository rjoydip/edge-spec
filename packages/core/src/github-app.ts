/**
 * GitHub App credentials: a short-lived JWT proves the app, an installation
 * token proves the repo. Both stay server-side; no user credential is stored.
 */
import { HttpError } from "./types";

export interface GitHubAppConfig {
  /** The numeric app id, as a string or number. */
  appId: string | number;
  /** PKCS#8 PEM. Environment secrets may contain literal `\n` escapes. */
  privateKey: string;
}

export interface InstallationToken {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface GitHubAppOptions {
  fetchImpl?: typeof fetch;
  /** Epoch milliseconds; injected so expiry is testable. */
  now?: number;
}

const encoder = new TextEncoder();

function base64url(value: string | ArrayBuffer): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemBytes(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

/**
 * An RS256 app JWT. GitHub accepts at most ten minutes; this uses nine and
 * backdates `iat` a minute for clock drift.
 */
export async function appJwt(config: GitHubAppConfig, now = Date.now()): Promise<string> {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iat: Math.floor(now / 1000) - 60,
      exp: Math.floor(now / 1000) + 540,
      iss: String(config.appId).trim(),
    }),
  );
  const unsigned = `${header}.${payload}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemBytes(config.privateKey),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new HttpError(
      501,
      "The GitHub App private key is not a valid PKCS#8 PEM. Check GH_APP_PRIVATE_KEY.",
    );
  }
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  return `${unsigned}.${base64url(signature)}`;
}

/**
 * Mints an installation token. `repo` is the repository name (`api` from
 * `acme/api`), so the token is scoped to that repository when possible.
 */
export async function installationToken(
  config: GitHubAppConfig,
  installationId: number | string,
  repo?: string,
  options: GitHubAppOptions = {},
): Promise<InstallationToken> {
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const jwt = await appJwt(config, now);
  const id = String(installationId).trim();
  if (!/^\d+$/.test(id)) {
    throw new HttpError(400, "The GitHub App installation id is not numeric.");
  }
  const name = repo?.trim().split("/").filter(Boolean).pop();
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.github.com/app/installations/${encodeURIComponent(id)}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${jwt}`,
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
        },
        body: JSON.stringify(name ? { repositories: [name] } : {}),
      },
    );
  } catch (error) {
    throw new HttpError(
      502,
      `GitHub App token request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new HttpError(
      502,
      `GitHub App token request returned ${response.status}. Check the app id, key and installation.`,
    );
  }
  let data: unknown;
  try {
    data = (await response.json()) as unknown;
  } catch {
    throw new HttpError(502, "GitHub App token response was not JSON.");
  }
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const token = typeof record.token === "string" ? record.token : "";
  const expires = Date.parse(typeof record.expires_at === "string" ? record.expires_at : "");
  if (!token || !Number.isFinite(expires)) {
    throw new HttpError(502, "GitHub App token response had no token or expiry.");
  }
  return { token, expiresAt: expires };
}

/**
 * Keeps installation tokens until shortly before GitHub expires them. One
 * instance per isolate is enough: the cache is an optimization, not state.
 */
export class InstallationTokenCache {
  private readonly entries = new Map<string, InstallationToken>();

  constructor(
    private readonly options: {
      fetchImpl?: typeof fetch;
      now?: () => number;
    } = {},
  ) {}

  async get(
    config: GitHubAppConfig,
    installationId: number | string,
    repo?: string,
  ): Promise<string> {
    const now = this.options.now?.() ?? Date.now();
    const key = `${installationId}:${repo ?? ""}`;
    const cached = this.entries.get(key);
    // Refresh a minute early so a request cannot start with a dead token.
    if (cached && cached.expiresAt - 60_000 > now) return cached.token;
    const fresh = await installationToken(config, installationId, repo, {
      now,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    });
    this.entries.set(key, fresh);
    return fresh.token;
  }
}

/** Reads the deployment's app credentials, when both are configured. */
export function gitHubAppFromEnv(env: {
  GH_APP_ID?: string;
  GH_APP_PRIVATE_KEY?: string;
}): GitHubAppConfig | undefined {
  const appId = env.GH_APP_ID?.trim();
  const privateKey = env.GH_APP_PRIVATE_KEY?.trim();
  return appId && privateKey ? { appId, privateKey } : undefined;
}
