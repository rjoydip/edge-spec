/**
 * Browser side of the CLI device login. Mirrors `packages/client/src/auth.ts`
 * (ponytail: copied payload crypto; keep in sync — the browser should not
 * bundle the CLI's node-side imports).
 */
import { getSettings, getSecrets, sandboxConfigOf } from "./settings";

export interface DevicePage {
  userCode: string;
  /** Payload key fragment, URL-safe base64url, or undefined when missing. */
  payloadKey?: string;
}

export const readDevicePage = (location: Location = window.location): DevicePage => {
  const url = new URL(location.href);
  const userCode = (url.searchParams.get("code") ?? "").trim().toUpperCase();
  const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const params = new URLSearchParams(fragment);
  const payloadKey = params.get("p")?.trim() || undefined;
  return { userCode, payloadKey };
};

const aesKey = async (payloadKey: string): Promise<CryptoKey> => {
  const b64 = payloadKey.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${b64}${"=".repeat((4 - (b64.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"]);
};

const toB64 = (bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
};

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

/** The settings a login grants, in exactly the CLI's request-header shape. */
export const profileForDevice = (): Record<string, unknown> => {
  const settings = getSettings();
  const secrets = getSecrets();
  const sandboxConfig = sandboxConfigOf(settings);
  return {
    provider: settings.provider,
    model: settings.model,
    accountId: settings.accountId,
    aiBaseUrl: settings.baseUrl,
    githubToken: secrets.githubToken,
    aiKey: secrets.aiKey,
    sandboxUrl: settings.sandboxUrl,
    sandboxKey: secrets.sandboxKey,
    ...(sandboxConfig ? { sandboxConfig: JSON.stringify(sandboxConfig) } : {}),
  };
};

export const approveDeviceCode = async (
  userCode: string,
  payloadKey: string,
): Promise<{ token: string }> => {
  const profile = await encryptProfile(profileForDevice(), payloadKey);
  const response = await fetch("/api/cli/device/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userCode, profile, workspace: window.location.origin }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: unknown; token?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : `Approved failed (${response.status}).`,
    );
  }
  return { token: typeof body.token === "string" ? body.token : "" };
};
