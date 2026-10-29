/**
 * CLI/MCP authorization: the GitHub device-flow UX, adapted for EdgeSpec.
 *
 * The CLI (or MCP host) displays a short user code and opens the dashboard's
 * `/authorize` page. The dashboard shows the same code, the user confirms the
 * match and approves, then the browser encrypts the visitor's configured
 * settings (AI model/key, GitHub token, sandbox runner — the same inputs the
 * dashboard keeps per user) with a payload key that only the CLI holds, and
 * the Worker relays the ciphertext back to the polling client.
 *
 * The deployment stores no user configuration (invariant 1): a device record
 * is transient state keyed by a random code, the profile travels as opaque
 * ciphertext (the payload key never reaches the server — the CLI hides it in
 * the URL fragment), and an approved record is consumed on first poll.
 */
import type { CacheStore } from "./env";

/** How long a device request (and an unread approval) may live. */
const REQUEST_TTL_SECONDS = 15 * 60;
/** An approved record survives this long even if approval came late. */
const APPROVAL_TTL_SECONDS = 2 * 60;

/** Alphabet is deliberately unambiguous — no 0/O, no 1/I. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface DeviceRecord {
  /** The code the CLI prints and the authorize page echoes back. */
  userCode: string;
  /** Opaque id the CLI polls with; possession is the whole proof. */
  deviceCode: string;
  /** Bearer token minted with the approval, for `auth status`. */
  token: string;
  expiresAt: number;
  /** Encrypted profile; the payload key never reaches the server. */
  profile?: string;
  /** The workspace origin that approved, so the CLI remembers where it logged in. */
  workspace?: string;
}

export type DevicePoll =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "approved"; token: string; profile: string; workspace: string };

export type DeviceDecision = { ok: true; token: string } | { ok: false; reason: "unknown-code" };

const DEVICE_KEY = "edgespec:device:";
const CODE_KEY = "edgespec:code:";

const randomCode = (length: number): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
};

export const userCodeFor = (): string => `${randomCode(4)}-${randomCode(4)}`;

const expired = (record: DeviceRecord): boolean => Date.now() > record.expiresAt;

const readRecord = async (
  store: CacheStore,
  deviceCode: string,
): Promise<DeviceRecord | undefined> => {
  const record = await store.get<DeviceRecord>(`${DEVICE_KEY}${deviceCode}`);
  if (!record) return undefined;
  if (expired(record)) {
    await store.delete(`${DEVICE_KEY}${deviceCode}`);
    await store.delete(`${CODE_KEY}${record.userCode}`);
    return undefined;
  }
  return record;
};

const ttlFor = (record: DeviceRecord, approved: boolean): number => {
  const remaining = Math.ceil((record.expiresAt - Date.now()) / 1000);
  // Once approved the record refuses to linger: the CLI polls within seconds,
  // so an unread approval dies with a short fuse, not a stale one.
  return approved ? Math.min(remaining, APPROVAL_TTL_SECONDS) : remaining;
};

/**
 * Creates one device handshake. Nothing here needs authenticated access:
 * anonymous visitors can mint codes, and every record stays worthless until
 * someone with a dashboard session approves it.
 */
export const startDeviceFlow = async (store: CacheStore): Promise<DeviceRecord> => {
  const record: DeviceRecord = {
    userCode: userCodeFor(),
    deviceCode: crypto.randomUUID(),
    token: `edgespec_${randomCode(32).toLowerCase()}`,
    expiresAt: Date.now() + REQUEST_TTL_SECONDS * 1000,
  };
  // The alias turns the human-readable code into the poll key. One approval
  // uses it and drops it, so a user code authorizes at most one record.
  await store.set(`${DEVICE_KEY}${record.deviceCode}`, record, REQUEST_TTL_SECONDS);
  await store.set(`${CODE_KEY}${record.userCode}`, record.deviceCode, REQUEST_TTL_SECONDS);
  return record;
};

/** The browser side approves: it adds the ciphertext, the server adds the token. */
export const approveDevice = async (
  store: CacheStore,
  input: { userCode: string; profile: string; workspace: string },
): Promise<DeviceDecision> => {
  const deviceCode = await store.get<string>(`${CODE_KEY}${input.userCode}`);
  if (!deviceCode) return { ok: false, reason: "unknown-code" };
  await store.delete(`${CODE_KEY}${input.userCode}`);
  const record = await readRecord(store, deviceCode);
  if (!record) return { ok: false, reason: "unknown-code" };
  const approved: DeviceRecord = {
    ...record,
    profile: input.profile,
    workspace: input.workspace,
  };
  await store.set(`${DEVICE_KEY}${deviceCode}`, approved, Math.max(ttlFor(record, true), 1));
  return { ok: true, token: record.token };
};

/** The CLI side polls. An approved record is consumed by the first poll. */
export const pollDevice = async (store: CacheStore, deviceCode: string): Promise<DevicePoll> => {
  const record = await readRecord(store, deviceCode);
  if (!record) return { status: "expired" };
  if (!record.profile) return { status: "pending" };
  await store.delete(`${DEVICE_KEY}${deviceCode}`);
  return {
    status: "approved",
    token: record.token,
    profile: record.profile,
    workspace: record.workspace ?? "",
  };
};
