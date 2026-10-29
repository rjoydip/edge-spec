import { describe, expect, it } from "bun:test";
import { authorizedCommenter, parsePrCommand } from "../src/pr-command";

describe("parsePrCommand", () => {
  it("parses the three commands and their arguments", () => {
    expect(parsePrCommand("/edgespec retest")).toEqual({ name: "retest" });
    expect(parsePrCommand("  /EdgeSpec COVERAGE ")).toEqual({
      name: "coverage",
    });
    expect(parsePrCommand("/edgespec explain GET /users/{id}")).toEqual({
      name: "explain",
      argument: "GET /users/{id}",
    });
  });

  it("ignores unrelated comments and explain without a target", () => {
    expect(parsePrCommand("looks good")).toBeUndefined();
    expect(parsePrCommand("/edgespec")).toBeUndefined();
    expect(parsePrCommand("/edgespec explain")).toBeUndefined();
    expect(parsePrCommand("/edgespec retest now")).toBeUndefined();
    expect(parsePrCommand("/edgespec deploy")).toBeUndefined();
  });
});

describe("authorizedCommenter", () => {
  it("allows owners, members and collaborators only", () => {
    for (const association of ["OWNER", "MEMBER", "COLLABORATOR"]) {
      expect(authorizedCommenter({ association })).toBe(true);
    }
    for (const association of ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "NONE", ""]) {
      expect(authorizedCommenter({ association })).toBe(false);
    }
  });

  it("ignores bots even with a collaborator association", () => {
    expect(authorizedCommenter({ association: "COLLABORATOR", userType: "Bot" })).toBe(false);
  });
});
