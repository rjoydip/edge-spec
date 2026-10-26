import { describe, expect, it } from "bun:test";
import { memoryPrompt, parseRepoMemory } from "../src/memory";

describe("parseRepoMemory", () => {
  it("keeps known fields and drops empty or unknown ones", () => {
    expect(
      parseRepoMemory({
        naming: " sibling .test.ts ",
        conventions: [" use the helper ", ""],
        helpers: ["src/test-utils.ts"],
        fixtures: ["tests/fixtures/users.json"],
        source: "not retained",
      }),
    ).toEqual({
      naming: "sibling .test.ts",
      conventions: ["use the helper"],
      helpers: ["src/test-utils.ts"],
      fixtures: ["tests/fixtures/users.json"],
    });
    expect(parseRepoMemory(null)).toEqual({});
  });

  it("caps lists and string lengths", () => {
    const memory = parseRepoMemory({
      conventions: Array.from({ length: 30 }, (_, index) => `rule ${index}`),
      naming: "x".repeat(500),
    });
    expect(memory.conventions).toHaveLength(20);
    expect(memory.naming).toHaveLength(200);
  });
});

describe("memoryPrompt", () => {
  it("formats a bounded approved-memory section", () => {
    const text = memoryPrompt({
      naming: "sibling .test.ts",
      conventions: ["use the helper"],
      helpers: ["src/test-utils.ts"],
      fixtures: ["tests/fixtures/users.json"],
    });
    expect(text).toContain("Approved repository memory");
    expect(text).toContain("Naming: sibling .test.ts");
    expect(text).toContain("Convention: use the helper");
    expect(text).toContain("Existing helper: src/test-utils.ts");
    expect(text).toContain("Existing fixture: tests/fixtures/users.json");
    expect(memoryPrompt({})).toBe("");
    expect(memoryPrompt(undefined)).toBe("");
  });
});
