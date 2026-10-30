import { describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { approveDevice, pollDevice, startDeviceFlow, userCodeFor } from "../src/device-flow";
import type { CacheStore, Env } from "../src/env";

/** In-memory CacheStore with TTL-free semantics; expiry is checked lazily. */
function cache(): CacheStore {
  const map = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => {
      map.set(key, value);
    },
    delete: async (key: string) => {
      map.delete(key);
    },
  };
}

describe("device flow", () => {
  test("codes are unambiguous and shaped", () => {
    for (let index = 0; index < 8; index += 1) {
      expect(userCodeFor()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  test("approve → poll → consumed", async () => {
    const store = cache();
    const record = await startDeviceFlow(store);
    const decision = await approveDevice(store, {
      userCode: record.userCode,
      profile: "encrypted-blob",
      workspace: "https://edgespec.example",
    });
    expect(decision.ok).toBe(true);
    const poll = await pollDevice(store, record.deviceCode);
    expect(poll.status).toBe("approved");
    if (poll.status === "approved") {
      expect(poll.profile).toBe("encrypted-blob");
      expect(poll.workspace).toBe("https://edgespec.example");
      expect(poll.token.startsWith("edgespec_")).toBe(true);
    }
    // The approved record is consumed on first poll: no replays.
    const second = await pollDevice(store, record.deviceCode);
    expect(second.status).toBe("expired");
  });

  test("an unknown or reused code is rejected", async () => {
    const store = cache();
    const decision = await approveDevice(store, {
      userCode: "ZZZZ-ZZZZ",
      profile: "x",
      workspace: "w",
    });
    expect(decision.ok).toBe(false);
  });

  test("a code approves at most one record", async () => {
    const store = cache();
    const first = await startDeviceFlow(store);
    const approved = await approveDevice(store, {
      userCode: first.userCode,
      profile: "one",
      workspace: "w",
    });
    expect(approved.ok).toBe(true);
    const reused = await approveDevice(store, {
      userCode: first.userCode,
      profile: "two",
      workspace: "w",
    });
    expect(reused.ok).toBe(false);
  });
});

describe("device routes", () => {
  const env = (store?: CacheStore) => ({ CACHE: store }) as Partial<Env> as Env;
  const post = (path: string, body: unknown, target: Env) =>
    app.fetch(
      new Request(`https://edge.example${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      target,
    );

  test("start → approve → poll through the HTTP surface", async () => {
    const store = cache();
    const startResponse = await post("/api/cli/device/start", {}, env(store));
    expect(startResponse.status).toBe(200);
    const started = (await startResponse.json()) as {
      deviceCode: string;
      userCode: string;
    };
    expect(started.userCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

    const approveResponse = await post(
      "/api/cli/device/approve",
      {
        userCode: started.userCode,
        profile: "cipher",
        workspace: "https://edge.example",
      },
      env(store),
    );
    expect(approveResponse.status).toBe(200);

    const pollResponse = await app.fetch(
      new Request(`https://edge.example/api/cli/device/poll?device=${started.deviceCode}`),
      env(store),
    );
    expect(pollResponse.status).toBe(200);
    const approved = (await pollResponse.json()) as {
      status: string;
      token: string;
      profile: string;
    };
    expect(approved.status).toBe("approved");
    expect(approved.profile).toBe("cipher");

    // Consumed: the next poll answers expired with 410.
    const replay = await app.fetch(
      new Request(`https://edge.example/api/cli/device/poll?device=${started.deviceCode}`),
      env(store),
    );
    expect(replay.status).toBe(410);
  });

  test("pending polls answer 202", async () => {
    const store = cache();
    const startResponse = await post("/api/cli/device/start", {}, env(store));
    const started = (await startResponse.json()) as { deviceCode: string };
    const pollResponse = await app.fetch(
      new Request(`https://edge.example/api/cli/device/poll?device=${started.deviceCode}`),
      env(store),
    );
    expect(pollResponse.status).toBe(202);
    expect(((await pollResponse.json()) as { status: string }).status).toBe("pending");
  });

  test("the deployment needs a cache store", async () => {
    const response = await post("/api/cli/device/start", {}, env(undefined));
    expect(response.status).toBe(501);
  });
});
