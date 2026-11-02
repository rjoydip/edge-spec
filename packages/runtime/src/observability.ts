/**
 * Observability. One `Observer` port, four selectable providers:
 *
 *   EDGESPEC_OBSERVABILITY=consola | otlp | sentry | axiom | none
 *
 * - `consola` (default): structured console lines, local development and logs.
 * - `otlp`: OpenTelemetry OTLP/HTTP JSON logs — Grafana, Honeycomb, Datadog,
 *   New Relic, Jaeger collectors all accept it. `OTEL_EXPORTER_OTLP_ENDPOINT`
 *   + optional `OTEL_EXPORTER_OTLP_HEADERS` (`key=value,key2=value2`).
 * - `sentry`: Sentry store API from `SENTRY_DSN`.
 * - `axiom`: Axiom ingest from `AXIOM_TOKEN` + `AXIOM_DATASET`.
 *
 * Every provider is a plain `fetch` (or console), so the same selection works
 * on Workers, Vercel, Lambda and the Bun server. Events are fire-and-forget;
 * the caller hands the promise to `waitUntil` when the platform has one.
 */
import consola from "consola";
import type { Env } from "./env";
import type { Observer, ObserverLevel } from "./ports";

export type { Observer, ObserverLevel } from "./ports";

export const OBSERVABILITY_LEVELS: readonly ObserverLevel[] = ["debug", "info", "warn", "error"];

export interface ObserverConfig {
  provider: "consola" | "otlp" | "sentry" | "axiom" | "none";
  level: ObserverLevel;
  service: string;
  environment?: string;
  endpoint?: string;
  headers?: Record<string, string>;
  dsn?: string;
  axiom?: { token: string; dataset: string; url?: string };
}

/** Reads the deployment's observability configuration; provider defaults to consola. */
export function observerConfigOf(env: Env): ObserverConfig {
  const provider = (env.EDGESPEC_OBSERVABILITY?.trim().toLowerCase() ||
    "consola") as ObserverConfig["provider"];
  const level = (env.EDGESPEC_LOG_LEVEL?.trim().toLowerCase() || "info") as ObserverLevel;
  const service = env.EDGESPEC_SERVICE_NAME?.trim() || "edgespec";
  const environment = env.EDGESPEC_ENV?.trim() || env.NODE_ENV?.trim() || undefined;
  const base = {
    provider,
    level: OBSERVABILITY_LEVELS.includes(level) ? level : "info",
    service,
    ...(environment ? { environment } : {}),
  } satisfies Omit<ObserverConfig, "provider"> & { provider: ObserverConfig["provider"] };

  if (provider === "otlp") {
    return {
      ...base,
      ...(env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
        ? { endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT.trim() }
        : {}),
      ...(env.OTEL_EXPORTER_OTLP_HEADERS?.trim()
        ? { headers: parseHeaderList(env.OTEL_EXPORTER_OTLP_HEADERS) }
        : {}),
    };
  }
  if (provider === "sentry") {
    return { ...base, ...(env.SENTRY_DSN?.trim() ? { dsn: env.SENTRY_DSN.trim() } : {}) };
  }
  if (provider === "axiom") {
    return {
      ...base,
      ...(env.AXIOM_TOKEN?.trim() && env.AXIOM_DATASET?.trim()
        ? {
            axiom: {
              token: env.AXIOM_TOKEN.trim(),
              dataset: env.AXIOM_DATASET.trim(),
              ...(env.AXIOM_URL?.trim() ? { url: env.AXIOM_URL.trim() } : {}),
            },
          }
        : {}),
    };
  }
  return base;
}

/** `Authorization=Basic abc, X-Scope-OrgID=tenant` → headers. */
export function parseHeaderList(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    headers[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return headers;
}

/** Resolves one observer for this deployment. Config with a missing driver is "none". */
export function observerFor(env: Env): Observer {
  const config = observerConfigOf(env);
  const threshold = OBSERVABILITY_LEVELS.indexOf(config.level);
  const allowed = (level: ObserverLevel): boolean =>
    OBSERVABILITY_LEVELS.indexOf(level) >= threshold;
  const sink = sinkFor(config);

  const emit = async (level: ObserverLevel, message: string, fields?: Record<string, unknown>) => {
    if (!allowed(level)) return;
    await sink(level, message, fields ?? {});
  };
  return {
    log: (level, message, fields) => {
      void emit(level, message, fields).catch(() => undefined);
    },
    event: (name, fields) => emit("info", name, fields),
    error: (error, fields) =>
      emit("error", error instanceof Error ? error.message : String(error), {
        ...fields,
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      }),
  };
}

type Sink = (
  level: ObserverLevel,
  message: string,
  fields: Record<string, unknown>,
) => Promise<void>;

function sinkFor(config: ObserverConfig): Sink {
  switch (config.provider) {
    case "otlp":
      return config.endpoint ? otlpSink(config) : consolaSink();
    case "sentry":
      return config.dsn ? sentrySink(config) : consolaSink();
    case "axiom":
      return config.axiom ? axiomSink(config) : consolaSink();
    case "none":
      return async () => {};
    default:
      return consolaSink();
  }
}

function consolaSink(): Sink {
  return async (level, message, fields) => {
    switch (level) {
      case "debug":
        consola.debug(message, fields);
        break;
      case "warn":
        consola.warn(message, fields);
        break;
      case "error":
        consola.error(message, fields);
        break;
      default:
        consola.info(message, fields);
        break;
    }
  };
}

/** OTLP/HTTP JSON: one log record per event, resource = service identity. */
function otlpSink(config: ObserverConfig): Sink {
  const endpoint = (config.endpoint as string).replace(/\/+$/, "");
  return async (level, message, fields) => {
    const body = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              attribute("service.name", config.service),
              ...(config.environment
                ? [attribute("deployment.environment", config.environment)]
                : []),
            ],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: String(Date.now() * 1_000_000),
                  severityText: level.toUpperCase(),
                  body: { stringValue: message },
                  attributes: Object.entries(fields).map(([key, value]) => attribute(key, value)),
                },
              ],
            },
          ],
        },
      ],
    };
    await postJson(`${endpoint}/v1/logs`, body, config.headers ?? {});
  };
}

function attribute(key: string, value: unknown): Record<string, unknown> {
  if (typeof value === "number") return { key, value: { intValue: String(value) } };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  return { key, value: { stringValue: value === undefined ? "" : String(value) } };
}

/** Sentry store API; the DSN carries key, host and project id. */
function sentrySink(config: ObserverConfig): Sink {
  const parsed = parseDsn(config.dsn as string);
  if (!parsed) return consolaSink();
  return async (level, message, fields) => {
    const auth = [
      "Sentry sentry_version=7",
      `sentry_key=${parsed.key}`,
      "sentry_client=edgespec/0.1",
    ].join(", ");
    await postJson(
      `${parsed.origin}/api/${parsed.project}/store/`,
      {
        event_id: crypto.randomUUID().replaceAll("-", ""),
        timestamp: new Date().toISOString(),
        platform: "javascript",
        level: level === "debug" ? "debug" : level,
        logger: config.service,
        message,
        environment: config.environment ?? "production",
        extra: fields,
      },
      { "x-sentry-auth": auth },
    );
  };
}

/** Axiom ingest: NDJSON rows. */
function axiomSink(config: ObserverConfig): Sink {
  const axiom = config.axiom as NonNullable<ObserverConfig["axiom"]>;
  const endpoint = (axiom.url ?? "https://api.axiom.co").replace(/\/+$/, "");
  return async (level, message, fields) => {
    await postJson(
      `${endpoint}/v1/datasets/${encodeURIComponent(axiom.dataset)}/ingest`,
      [
        {
          _time: new Date().toISOString(),
          level,
          message,
          service: config.service,
          ...(config.environment ? { environment: config.environment } : {}),
          ...fields,
        },
      ],
      { authorization: `Bearer ${axiom.token}` },
    );
  };
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<void> {
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** `https://<key>@<host>/<project>` → origin, key and project. */
export function parseDsn(
  dsn: string,
): { origin: string; key: string; project: string } | undefined {
  try {
    const url = new URL(dsn);
    if (!url.username || !url.pathname) return undefined;
    const project = url.pathname.replace(/^\/+/, "");
    if (!project) return undefined;
    return { origin: url.origin, key: url.username, project };
  } catch {
    return undefined;
  }
}
