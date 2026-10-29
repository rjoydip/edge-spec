import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearCredentials,
  credentialsPath,
  effectiveEnv,
  readCredentials,
  writeCredentials,
  type AuthFile,
} from "../src/credentials";

const home = mkdtempSync(join(tmpdir(), "edgespec-auth-"));

afterEach(() => {
  rmSync(credentialsPath(home), { force: true });
});

const authFile = (overrides: Partial<AuthFile["profile"]> = {}): AuthFile => ({
  workspace: "https://edgespec.example",
  token: "edgespec_testtoken1234567890",
  authorizedAt: Date.now(),
  profile: {
    githubToken: "gh_token_1",
    aiKey: "ai_key_1",
    sandboxUrl: "https://runner.example",
    sandboxKey: "runner_key_1",
    ...overrides,
  },
});

describe("credentials file", () => {
  test("round trips and clears", () => {
    const file = authFile();
    writeCredentials(file, home);
    expect(readCredentials(home)?.profile.aiKey).toBe("ai_key_1");
    clearCredentials(home);
    expect(readCredentials(home)).toBeUndefined();
  });

  test("not logged in reads undefined", () => {
    expect(readCredentials(home)).toBeUndefined();
  });
});

describe("effectiveEnv", () => {
  test("fills the keys the shell leaves empty", () => {
    const merged = effectiveEnv({}, authFile());
    expect(merged.EDGESPEC_URL).toBe("https://edgespec.example");
    expect(merged.GH_TOKEN).toBe("gh_token_1");
    expect(merged.EDGESPEC_AI_KEY).toBe("ai_key_1");
    expect(merged.EDGESPEC_SANDBOX_URL).toBe("https://runner.example");
    expect(merged.EDGESPEC_SANDBOX_KEY).toBe("runner_key_1");
  });

  test("the environment always wins", () => {
    const merged = effectiveEnv(
      {
        EDGESPEC_URL: "https://self-hosted.example",
        GH_TOKEN: "gh_env",
        EDGESPEC_AI_KEY: "ai_env",
      },
      authFile(),
    );
    expect(merged.EDGESPEC_URL).toBe("https://self-hosted.example");
    expect(merged.GH_TOKEN).toBe("gh_env");
    expect(merged.EDGESPEC_AI_KEY).toBe("ai_env");
  });
});
