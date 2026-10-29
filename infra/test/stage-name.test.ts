import { expect, test } from "bun:test";
import { stageSlug } from "../alchemy.run.ts";

// Cloudflare rejected `edge-spec-artifacts-live_<user>`: buckets allow only
// lowercase letters, numbers and hyphens.
test("stage names become Cloudflare-safe slugs", () => {
  expect(stageSlug("prod")).toBe("prod");
  expect(stageSlug("live_rjoydip")).toBe("live-rjoydip");
  expect(stageSlug("PR_123")).toBe("pr-123");
  expect(stageSlug("--a__b--")).toBe("a-b");
  expect(stageSlug("")).toBe("dev");
  expect(stageSlug("x".repeat(60)).length).toBeLessThanOrEqual(40);
  expect(stageSlug("x".repeat(41))).toBe("x".repeat(40));
});
