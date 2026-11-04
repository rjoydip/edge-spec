import type { ScheduledRepo } from "./db";
import type { Env } from "./env";

export type DriftWebhookSource = "repository" | "environment";

export interface DriftWebhookTarget {
  url: string;
  secret?: string;
  source: DriftWebhookSource;
}

/**
 * Resolve the effective drift notification target.
 *
 * A repository override wins over the deployment environment. Empty values
 * are ignored.
 */
export function resolveDriftWebhook(
  env: Pick<Env, "DRIFT_ALERT_WEBHOOK_URL" | "DRIFT_ALERT_WEBHOOK_SECRET">,
  schedule: Pick<ScheduledRepo, "driftWebhookUrl" | "driftWebhookSecret">,
): DriftWebhookTarget | undefined {
  const repositoryUrl = schedule.driftWebhookUrl?.trim();
  if (repositoryUrl) {
    return {
      url: repositoryUrl,
      ...(schedule.driftWebhookSecret?.trim()
        ? { secret: schedule.driftWebhookSecret.trim() }
        : {}),
      source: "repository",
    };
  }

  const environmentUrl = env.DRIFT_ALERT_WEBHOOK_URL?.trim();
  if (environmentUrl) {
    return {
      url: environmentUrl,
      ...(env.DRIFT_ALERT_WEBHOOK_SECRET?.trim()
        ? { secret: env.DRIFT_ALERT_WEBHOOK_SECRET.trim() }
        : {}),
      source: "environment",
    };
  }

  return undefined;
}
