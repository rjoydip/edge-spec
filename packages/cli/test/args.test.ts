import { describe, expect, it } from "bun:test";
import { parseCliArgs, UsageError } from "../src/args";

describe("parseCliArgs", () => {
  it("parses scan options", () => {
    const parsed = parseCliArgs([
      "scan",
      "owner/repo",
      "--url",
      "https://edge.test",
      "--ref",
      "dev",
      "--folder",
      "packages",
      "--limit",
      "5",
      "--json",
    ]);
    expect(parsed).toEqual({
      command: "scan",
      repo: "owner/repo",
      url: "https://edge.test",
      ref: "dev",
      folder: "packages",
      limit: 5,
      json: true,
    });
  });

  it("parses generate options and negated strict types", () => {
    const parsed = parseCliArgs([
      "generate",
      "owner/repo",
      "src/a.ts",
      "--provider",
      "openai",
      "--model",
      "gpt-test",
      "--coverage-target",
      "80",
      "--max-retries",
      "2",
      "--max-ai-retries",
      "1",
      "--no-strict-types",
      "--sandbox-url",
      "https://runner.test",
      "--out",
      "tmp/a.test.ts",
      "--pr",
    ]);
    expect(parsed).toEqual({
      command: "generate",
      repo: "owner/repo",
      path: "src/a.ts",
      provider: "openai",
      model: "gpt-test",
      coverageTarget: 80,
      maxRetries: 2,
      maxAiRetries: 1,
      strictTypes: false,
      sandboxUrl: "https://runner.test",
      out: "tmp/a.test.ts",
      pr: true,
      json: false,
    });
  });

  it("parses run and catalog", () => {
    expect(parseCliArgs(["run", "owner/repo", "--max-files", "3", "--json"])).toMatchObject({
      command: "run",
      repo: "owner/repo",
      maxFiles: 3,
      json: true,
    });
    expect(parseCliArgs(["catalog", "--url", "https://edge.test", "--json"])).toEqual({
      command: "catalog",
      url: "https://edge.test",
      json: true,
    });
  });

  it("returns help for no arguments and for --help", () => {
    expect(parseCliArgs([])).toEqual({ command: "help" });
    expect(parseCliArgs(["scan", "--help"])).toEqual({
      command: "help",
      topic: "scan",
    });
  });

  it("rejects missing positionals and invalid numbers", () => {
    expect(() => parseCliArgs(["scan"])).toThrow(UsageError);
    expect(() => parseCliArgs(["generate", "owner/repo"])).toThrow(UsageError);
    expect(() => parseCliArgs(["run", "owner/repo", "--max-files", "0"])).toThrow(UsageError);
    expect(() => parseCliArgs(["scan", "owner/repo", "--limit", "101"])).toThrow(UsageError);
    expect(() => parseCliArgs(["nope"])).toThrow(UsageError);
  });
});
