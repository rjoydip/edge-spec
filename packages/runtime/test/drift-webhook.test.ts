import { describe, expect, it } from "bun:test";
import { resolveDriftWebhook } from "../src/drift-webhook";

const env = {
  DRIFT_ALERT_WEBHOOK_URL: "https://hooks.example/environment",
  DRIFT_ALERT_WEBHOOK_SECRET: "env-secret",
};

const schedule = {
  repo: "acme/api",
  intervalDays: 7,
  enabled: true,
  driftWebhookUrl: "https://hooks.example/repository",
  driftWebhookSecret: "repo-secret",
};

describe("resolveDriftWebhook", () => {
  it("prefers the repository, then the environment", () => {
    expect(resolveDriftWebhook(env, schedule)).toEqual({
      url: "https://hooks.example/repository",
      secret: "repo-secret",
      source: "repository",
    });
    expect(resolveDriftWebhook(env, { ...schedule, driftWebhookUrl: "" })).toEqual({
      url: "https://hooks.example/environment",
      secret: "env-secret",
      source: "environment",
    });
  });

  it("returns undefined when no layer has a URL", () => {
    expect(
      resolveDriftWebhook({ DRIFT_ALERT_WEBHOOK_URL: "" }, { ...schedule, driftWebhookUrl: "" }),
    ).toBeUndefined();
  });
});
