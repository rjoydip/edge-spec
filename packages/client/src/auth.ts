/**
 * Device-flow login for the CLI and MCP server, shared through packages/client.
 *
 * The client displays a user code, opens `<workspace>/authorize` (payload key
 * in the URL fragment, so the server never sees it), polls
 * `/api/cli/device/poll`, and decrypts the approved profile.
 *
 * Key headers travel exactly like the dashboard's: secrets stay request
 * headers, never flags or tool arguments (invariant 9).
 */

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  expiresAt: string;
}

export interface DevicePollResult {
  status: "pending" | "expired" | "approved";
  token?: string;
  profile?: string;
  workspace?: string;
}

const base = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Payload crypto: AES-GCM 256. Runs in Bun, Node >=20 and browsers alike.

const payloadKeyB64 = (key: ArrayBuffer | Uint8Array): string => {
  const bytes = key instanceof Uint8Array ? key : new Uint8Array(key);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const payloadKeyBytes = (b64url: string): ArrayBuffer => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${b64}${"=".repeat((4 - (b64.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

export const generatePayloadKey = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return payloadKeyB64(bytes);
};

const aesKey = (b64url: string): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", payloadKeyBytes(b64url), "AES-GCM", false, ["encrypt", "decrypt"]);

const toB64 = (bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromB64 = (b64: string): ArrayBuffer => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

/** AES-GCM: 12 random bytes IV, ciphertext alone, then base64(iv | data). */
export const encryptProfile = async (
  profile: Record<string, unknown>,
  payloadKey: string,
): Promise<string> => {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const data = new TextEncoder().encode(JSON.stringify(profile));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(payloadKey),
    data,
  );
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.length);
  return toB64(combined.buffer);
};

export const decryptProfile = async (
  cipher: string,
  payloadKey: string,
): Promise<Record<string, unknown>> => {
  const combined = new Uint8Array(fromB64(cipher));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    await aesKey(payloadKey),
    data as unknown as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Device endpoints.

export const startDeviceFlow = async (
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceStart> => {
  const response = await fetchImpl(`${base(baseUrl)}/api/cli/device/start`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`EdgeSpec could not start a device login: ${await errorMessage(response)}`);
  }
  return (await response.json()) as DeviceStart;
};

export const pollDeviceFlow = async (
  baseUrl: string,
  deviceCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DevicePollResult> => {
  const response = await fetchImpl(
    `${base(baseUrl)}/api/cli/device/poll?device=${encodeURIComponent(deviceCode)}`,
  );
  if (!response.ok) throw new Error(`EdgeSpec login poll failed: ${await errorMessage(response)}`);
  return (await response.json()) as DevicePollResult;
};

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // Not JSON; raw text below.
  }
  return text.slice(0, 400) || `Request failed (${response.status}).`;
}

/**
 * The URL the CLI opens: the authorize page reads `?code=` and ignores the
 * `#p=` fragment (only the browser sees the payload key this way).
 */
export const authorizeUrl = (baseUrl: string, userCode: string, payloadKey: string): string =>
  `${base(baseUrl)}/authorize?code=${encodeURIComponent(userCode)}#p=${encodeURIComponent(payloadKey)}`;

/** Open a URL in the user's browser; failure is silent (the code is printed). */
export const openBrowser = (url: string): void => {
  try {
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const launcher =
      process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(launcher, args, { stdio: "ignore", detached: true });
    child.unref();
  } catch {
    // Not fatal: the console shows the URL either way.
  }
};

// ---------------------------------------------------------------------------
// Riding on the stored profile.
