import { describe, expect, it } from "bun:test";
import {
  cloneCommand,
  parseRunRequest,
  remoteCwd,
  safeRelative,
  shellQuote,
} from "../src/contract";

describe("Cloudflare sandbox contract", () => {
  it("accepts a v1 body and defaults", () => {
    const parsed = parseRunRequest({
      files: { "src/a.test.ts": "test" },
      command: "bun test",
    });
    expect(parsed.command).toBe("bun test");
    expect(parsed.files).toEqual({ "src/a.test.ts": "test" });
    expect(parsed.setup).toEqual([]);
    expect(parsed.env).toEqual({});
  });

  it("refuses traversal and absolute paths", () => {
    expect(() => safeRelative("../secret", "files path")).toThrow("inside the workspace");
    expect(() => safeRelative("/etc/passwd", "cwd")).toThrow("inside the workspace");
    expect(() => parseRunRequest({ files: { "../a": "x" }, command: "bun test" })).toThrow();
    expect(remoteCwd("/workspace/repo", "packages/api")).toBe("/workspace/repo/packages/api");
  });

  it("requires https repositories and safe refs", () => {
    expect(() =>
      parseRunRequest({
        command: "bun test",
        repo: { url: "http://example.test/repo.git" },
      }),
    ).toThrow("https");
    expect(() =>
      parseRunRequest({
        command: "bun test",
        repo: { url: "https://github.com/acme/api.git", ref: "main; rm -rf /" },
      }),
    ).toThrow("valid ref");
  });

  it("keeps the clone token out of the command", () => {
    const command = cloneCommand(
      { url: "https://github.com/acme/api.git", ref: "main", token: "ghs_secret" },
      "/workspace/repo",
    );
    expect(command).toContain("$GIT_TOKEN");
    expect(command).not.toContain("ghs_secret");
    expect(command).toContain("--branch 'main'");
  });

  it("clamps timeouts and quotes shell words", () => {
    expect(parseRunRequest({ command: "bun test", timeoutMs: 1 }).timeoutMs).toBe(10_000);
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });
});
