import { afterEach, describe, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../server";

let server: Server | undefined;

afterEach(() => {
  if (server?.listening) server.close();
  server = undefined;
});

async function start(): Promise<string> {
  const current = createApp();
  server = current;
  await new Promise<void>((resolve) => current.listen(0, "127.0.0.1", resolve));

  const address = current.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("pure node server", () => {
  test("serves plain text on the root route", async () => {
    const base = await start();
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello from node");
  });

  test("returns JSON for an unknown route", async () => {
    const base = await start();
    const response = await fetch(`${base}/missing`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not found" });
  });
});
