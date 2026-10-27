import { describe, expect, it } from "bun:test";
import { providerById } from "../src/catalog";
import { modelTier, routeModel } from "../src/routing";

describe("routeModel", () => {
  const openai = providerById("openai");
  if (!openai) throw new Error("catalog lost openai");

  it("routes small first attempts to the cheap model", () => {
    expect(routeModel(openai, { sourceLength: 1_000 })).toBe("gpt-6-luna");
  });

  it("routes large files and retries to the strong model", () => {
    expect(routeModel(openai, { sourceLength: 20_000 })).toBe("gpt-6-astra");
    expect(routeModel(openai, { sourceLength: 1_000, retry: true })).toBe("gpt-6-astra");
  });

  it("uses the balanced tier in the middle", () => {
    expect(routeModel(openai, { sourceLength: 4_000 })).toBe("gpt-6.1-sol");
  });

  it("leaves a custom or single-model provider alone", () => {
    const custom = providerById("private");
    if (!custom) throw new Error("catalog lost private");
    expect(routeModel(custom, { sourceLength: 10_000 })).toBeUndefined();
  });

  it("reads explicit tiers", () => {
    const anthropic = providerById("anthropic");
    if (!anthropic) throw new Error("catalog lost anthropic");
    expect(modelTier(anthropic, "claude-haiku-5-5")).toBe("cheap");
    expect(modelTier(anthropic, "claude-president")).toBeUndefined();
  });
});
