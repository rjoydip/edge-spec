import { describe, expect, test } from "bun:test";
import { observerConfigOf, observerFor, parseDsn, parseHeaderList } from "../src/observability";
import type { Env } from "../src/env";

const env = (values: Record<string, string>): Env => values as Env;

describe("observability config", () => {
  test("defaults to consola at info level", () => {
    expect(observerConfigOf(env({}))).toMatchObject({
      provider: "consola",
      level: "info",
      service: "edgespec",
    });
  });

  test("reads the OTLP endpoint and header list", () => {
    const config = observerConfigOf(
      env({
        EDGESPEC_OBSERVABILITY: "OTLP",
        EDGESPEC_LOG_LEVEL: "debug",
        EDGESPEC_SERVICE_NAME: "api",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp.example/otlp/",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic abc, X-Scope-OrgID=tenant",
      }),
    );
    expect(config.provider).toBe("otlp");
    expect(config.level).toBe("debug");
    expect(config.service).toBe("api");
    expect(config.endpoint).toBe("https://otlp.example/otlp/");
    expect(config.headers).toEqual({
      Authorization: "Basic abc",
      "X-Scope-OrgID": "tenant",
    });
  });

  test("an invalid level falls back to info", () => {
    expect(observerConfigOf(env({ EDGESPEC_LOG_LEVEL: "verbose" })).level).toBe("info");
  });

  test("sentry and axiom pick their credentials", () => {
    expect(
      observerConfigOf(
        env({ EDGESPEC_OBSERVABILITY: "sentry", SENTRY_DSN: "https://k@o1.ingest.sentry.io/2" }),
      ),
    ).toMatchObject({ provider: "sentry", dsn: "https://k@o1.ingest.sentry.io/2" });
    expect(
      observerConfigOf(
        env({
          EDGESPEC_OBSERVABILITY: "axiom",
          AXIOM_TOKEN: "xaat-1",
          AXIOM_DATASET: "edgespec",
        }),
      ),
    ).toMatchObject({ provider: "axiom", axiom: { token: "xaat-1", dataset: "edgespec" } });
  });
});

describe("observability drivers", () => {
  test("header list parsing ignores malformed pairs", () => {
    expect(parseHeaderList("a=1,,b=2,c")).toEqual({ a: "1", b: "2" });
  });

  test("a Sentry DSN yields origin, key and project", () => {
    expect(parseDsn("https://public@o1.ingest.sentry.io/42")).toEqual({
      origin: "https://o1.ingest.sentry.io",
      key: "public",
      project: "42",
    });
    expect(parseDsn("not-a-dsn")).toBeUndefined();
  });

  test("none is a no-op observer", async () => {
    const observer = observerFor(env({ EDGESPEC_OBSERVABILITY: "none" }));
    await expect(observer.event("x")).resolves.toBeUndefined();
    await expect(observer.error(new Error("boom"))).resolves.toBeUndefined();
    observer.log("error", "silent");
  });

  test("a provider missing its config falls back to consola, not a crash", async () => {
    const observer = observerFor(env({ EDGESPEC_OBSERVABILITY: "otlp" }));
    await expect(observer.event("fallback", { ok: true })).resolves.toBeUndefined();
  });
});
