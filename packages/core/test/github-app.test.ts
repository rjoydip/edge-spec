import { describe, expect, it } from "bun:test";
import {
  InstallationTokenCache,
  appJwt,
  gitHubAppFromEnv,
  installationToken,
} from "../src/github-app";
import { HttpError } from "../src/types";

function base64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toPem(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  const body =
    btoa(binary)
      .match(/.{1,64}/g)
      ?.join("\n") ?? "";
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64urlToBytes(part))) as Record<string, unknown>;
}

let keys: Promise<{ pem: string; publicKey: CryptoKey }> | undefined;

/** One RSA key for the suite; generating one is the slow part. */
function testKeys(): Promise<{ pem: string; publicKey: CryptoKey }> {
  keys ??= (async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
    return { pem: toPem(pkcs8), publicKey: pair.publicKey };
  })();
  return keys;
}

describe("appJwt", () => {
  it("signs the app id with a short expiry that GitHub accepts", async () => {
    const { pem, publicKey } = await testKeys();
    const now = 1_700_000_000_000;
    const jwt = await appJwt({ appId: 12345, privateKey: pem }, now);
    const [header, payload, signature] = jwt.split(".");
    if (!header || !payload || !signature) throw new Error("malformed JWT");

    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(payload)).toEqual({
      iat: 1_699_999_940,
      exp: 1_700_000_540,
      iss: "12345",
    });
    expect(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        base64urlToBytes(signature).buffer as ArrayBuffer,
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).toBe(true);
  });

  it("refuses a malformed key without echoing it", async () => {
    await expect(appJwt({ appId: "1", privateKey: "not a pem" })).rejects.toThrow(
      /GH_APP_PRIVATE_KEY/,
    );
  });
});

describe("installationToken", () => {
  it("requests a repo-scoped token and reads the expiry", async () => {
    const { pem } = await testKeys();
    const calls: Array<{ url: string; body: unknown; authorization: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        authorization: headers.authorization ?? "",
      });
      return new Response(
        JSON.stringify({
          token: "ghs_test",
          expires_at: "2026-10-26T12:00:00Z",
        }),
        {
          status: 201,
        },
      );
    }) as unknown as typeof fetch;

    const token = await installationToken({ appId: "1", privateKey: pem }, 42, "acme/api", {
      fetchImpl,
      now: 1_700_000_000_000,
    });

    expect(token.token).toBe("ghs_test");
    expect(token.expiresAt).toBe(Date.parse("2026-10-26T12:00:00Z"));
    expect(calls[0]?.url).toContain("/app/installations/42/access_tokens");
    expect(calls[0]?.body).toEqual({ repositories: ["api"] });
    expect(calls[0]?.authorization.startsWith("Bearer ")).toBe(true);
  });

  it("rejects a non-numeric installation id before calling GitHub", async () => {
    const { pem } = await testKeys();
    await expect(
      installationToken({ appId: "1", privateKey: pem }, "not-a-number"),
    ).rejects.toBeInstanceOf(HttpError);
  });
});

describe("InstallationTokenCache", () => {
  it("reuses a token until shortly before expiry, then refreshes", async () => {
    const { pem } = await testKeys();
    let clock = 1_700_000_000_000;
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          token: `ghs_${calls}`,
          expires_at: new Date(clock + 3_600_000).toISOString(),
        }),
        { status: 201 },
      );
    }) as unknown as typeof fetch;
    const cache = new InstallationTokenCache({ fetchImpl, now: () => clock });
    const config = { appId: "1", privateKey: pem };

    expect(await cache.get(config, 42, "acme/api")).toBe("ghs_1");
    expect(await cache.get(config, 42, "acme/api")).toBe("ghs_1");
    expect(calls).toBe(1);

    // Still inside the sixty-second safety window: the cached token is used.
    clock += 3_500_000;
    expect(await cache.get(config, 42, "acme/api")).toBe("ghs_1");

    // At expiry the cache must mint again.
    clock += 100_000;
    expect(await cache.get(config, 42, "acme/api")).toBe("ghs_2");
    expect(calls).toBe(2);
  });
});

describe("gitHubAppFromEnv", () => {
  it("needs both the app id and the key", () => {
    expect(gitHubAppFromEnv({ GH_APP_ID: "1" })).toBeUndefined();
    expect(gitHubAppFromEnv({ GH_APP_PRIVATE_KEY: "pem" })).toBeUndefined();
    expect(gitHubAppFromEnv({ GH_APP_ID: "1", GH_APP_PRIVATE_KEY: "pem" })).toEqual({
      appId: "1",
      privateKey: "pem",
    });
  });
});
