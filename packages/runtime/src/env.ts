import type { AiBinding } from "@edge-spec/core/ai";
import type {
  CacheStore,
  CacheDriver,
  JobInstance,
  JobQueue,
  JobStatus,
  ObjectStore,
  ObserverLevel,
  SqlDatabase,
  SqlStatement,
} from "./ports";

/**
 * The ports are declared in `./ports`; re-exported here so every existing
 * `@edge-spec/runtime/env` import keeps working.
 */
export type {
  CacheDriver,
  CacheStore,
  EmailSender,
  JobInstance,
  JobQueue,
  JobStatus,
  ObjectStore,
  ObserverLevel,
  SqlDatabase,
  SqlStatement,
} from "./ports";

export interface Env {
  /** Static-assets binding. Absent when the host serves the bundle itself. */
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  /** Optional artifact bucket for drift summaries and run bundles. */
  BLOB?: ObjectStore;
  /** @deprecated use BLOB */
  ARTIFACTS?: ObjectStore;
  /** Optional run history. Absent on a deployment that does not want it. */
  DB?: SqlDatabase;
  /** @deprecated use DB */
  RUNS_DB?: SqlDatabase;
  /** Optional durable jobs. Absent means webhook automation is unavailable. */
  JOBS?: JobQueue;
  /** @deprecated use JOBS */
  TEST_GENERATION_WORKFLOW?: JobQueue;
  /** "true" when JOBS replays after a crash. */
  JOBS_DURABLE?: string;
  /** Optional read-through cache. */
  CACHE?: CacheStore;
  CACHE_DRIVER?: CacheDriver;
  /** Guards POST /api/cron/tick. Absent disables the route. */
  CRON_SECRET?: string;
  /** Optional Slack-compatible webhook for drift notifications. */
  DRIFT_ALERT_WEBHOOK_URL?: string;
  DRIFT_ALERT_WEBHOOK_SECRET?: string;
  /** Workers AI binding, or provider config for the automation path. */
  AI?: AiBinding;
  AI_PROVIDER?: string;
  AI_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  /** Automation path only. The dashboard always uses the visitor's own token. */
  GH_TOKEN?: string;
  /** GitHub App credentials for CI. Short-lived installation tokens are minted. */
  GH_APP_ID?: string;
  GH_APP_PRIVATE_KEY?: string;
  GH_WEBHOOK_SECRET?: string;
  /**
   * Optional deployment fallback for automation runs. Interactive requests
   * normally supply the runner through `x-sandbox-url` / `x-sandbox-key`.
   */
  SANDBOX_RUNNER_URL?: string;
  SANDBOX_API_KEY?: string;
  /** Email sender fallback (Resend). Requests normally carry it as a header. */
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Manual plan activation endpoint guard. Absent disables it. */
  ADMIN_KEY?: string;
  /** The public origin used in emails; defaults to the request origin. */
  EDGESPEC_WORKSPACE_URL?: string;
  /** Observability: consola (default), otlp, sentry, axiom or none. */
  EDGESPEC_OBSERVABILITY?: string;
  EDGESPEC_LOG_LEVEL?: ObserverLevel;
  EDGESPEC_SERVICE_NAME?: string;
  EDGESPEC_ENV?: string;
  NODE_ENV?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
  SENTRY_DSN?: string;
  AXIOM_TOKEN?: string;
  AXIOM_DATASET?: string;
  AXIOM_URL?: string;
  /** Better Auth signing secret; set it in production. */
  BETTER_AUTH_SECRET?: string;
  /** Set to 1 only when serving over plain HTTP (local Docker). */
  EDGESPEC_INSECURE_COOKIES?: string;
}

/** @deprecated use SqlStatement */
export type D1PreparedStatement = SqlStatement;
/** @deprecated use SqlDatabase */
export type D1Database = SqlDatabase;
/** @deprecated use ObjectStore */
export type R2Bucket = ObjectStore;
/** @deprecated use JobQueue */
export type WorkflowBinding = JobQueue;
/** @deprecated use JobStatus */
export type WorkflowStatus = JobStatus;
/** @deprecated use JobInstance */
export type WorkflowInstance = JobInstance;
