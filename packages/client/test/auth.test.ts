import { describe, expect, test } from "bun:test";
import { authorizeUrl, decryptProfile, encryptProfile, generatePayloadKey } from "../src/auth";

describe("device payload crypto", () => {
  test("encrypts round trip with the payload key", async () => {
    const payloadKey = generatePayloadKey();
    const cipher = await encryptProfile({ aiKey: "sk-1", nested: { ok: true } }, payloadKey);
    const plain = await decryptProfile(cipher, payloadKey);
    expect((plain as { aiKey: string }).aiKey).toBe("sk-1");
    expect((plain as { nested: { ok: boolean } }).nested.ok).toBe(true);
  });

  test("a different payload key fails to decrypt", async () => {
    const cipher = await encryptProfile({ aiKey: "sk-1" }, generatePayloadKey());
    await expect(decryptProfile(cipher, generatePayloadKey())).rejects.toThrow();
  });
});

describe("authorize url", () => {
  test("carries the code in the query and the payload key in the fragment", () => {
    const url = new URL(authorizeUrl("https://edge.example/", "ABCD-1234", "p4yL04Dk3y=_"));
    expect(url.origin).toBe("https://edge.example");
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("code")).toBe("ABCD-1234");
    expect(url.hash).toBe("#p=p4yL04Dk3y%3D_");
  });
});
