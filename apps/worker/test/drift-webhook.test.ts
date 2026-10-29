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

const workspace = {
  id: "default",
  name: "Workspace",
  retentionDays: 30,
  driftWebhookUrl: "https://hooks.example/workspace",
  driftWebhookSecret: "workspace-secret",
  createdAt: 1,
  updatedAt: 1,
};

describe("resolveDriftWebhook", () => {
  it("prefers repository, then workspace, then environment", () => {
    expect(resolveDriftWebhook(env, schedule, workspace)).toEqual({
      url: "https://hooks.example/repository",
      secret: "repo-secret",
      source: "repository",
    });
    expect(resolveDriftWebhook(env, { ...schedule, driftWebhookUrl: "" }, workspace)).toEqual({
      url: "https://hooks.example/workspace",
      secret: "workspace-secret",
      source: "workspace",
    });
    expect(
      resolveDriftWebhook(
        env,
        { ...schedule, driftWebhookUrl: "" },
        {
          ...workspace,
          driftWebhookUrl: undefined,
        },
      ),
    ).toEqual({
      url: "https://hooks.example/environment",
      secret: "env-secret",
      source: "environment",
    });
  });

  it("returns undefined when no layer has a URL", () => {
    expect(
      resolveDriftWebhook(
        { DRIFT_ALERT_WEBHOOK_URL: "" },
        { ...schedule, driftWebhookUrl: "" },
        { ...workspace, driftWebhookUrl: undefined },
      ),
    ).toBeUndefined();
  });
});
