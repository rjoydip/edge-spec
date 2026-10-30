/**
 * The CLI/MCP authorize screen is a deep-link surface, never a launch screen.
 * These cases pin the routing decision that turned it on for everyone.
 */
import { describe, expect, test } from "bun:test";
import { readDevicePage } from "../src/lib/device";

const at = (href: string, pathname = new URL(href).pathname) => ({ href, pathname });

describe("readDevicePage", () => {
  test("is undefined on ordinary app URLs", () => {
    expect(readDevicePage(at("https://edge.example/"))).toBeUndefined();
    expect(readDevicePage(at("https://edge.example/login"))).toBeUndefined();
    expect(readDevicePage(at("https://edge.example/pricing"))).toBeUndefined();
    expect(readDevicePage(at("https://edge.example/authorize"))).toBeUndefined();
  });

  test("reads the code and payload key from the CLI device link", () => {
    expect(readDevicePage(at("https://edge.example/authorize?code=abcd-2345#p=key123"))).toEqual({
      userCode: "ABCD-2345",
      payloadKey: "key123",
    });
  });

  test("keeps a code-only link so the page can explain a broken link", () => {
    expect(readDevicePage(at("https://edge.example/authorize?code=ABCD-2345"))).toEqual({
      userCode: "ABCD-2345",
      payloadKey: undefined,
    });
  });
});
