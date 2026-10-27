import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { expect } from "bun:test";
import Stack from "../alchemy.run.ts";

/**
 * Opt-in live stack test. The file is deliberately not named `*.test.ts`, so
 * plain `bun test` never provisions cloud resources.
 *
 *   bun run test:stack
 *   ALCHEMY_DEV=1 bun run test:stack
 *   SKIP_DEPLOY=1 STACK_URL=https://… bun run test:stack
 */
const localDev = /^(1|true)$/i.test(process.env.ALCHEMY_DEV ?? "");

const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: Cloudflare.providers(),
  // `ALCHEMY_DEV=1` runs local providers; Cloudflare state would still ask
  // for cloud credentials. Omit it so the harness uses local state.
  ...(localDev ? {} : { state: Cloudflare.state() }),
});

const deployed = beforeAll(
  process.env.SKIP_DEPLOY ? Effect.succeed({ url: process.env.STACK_URL ?? "" }) : deploy(Stack),
  { timeout: 300_000 },
);

afterAll.skipIf(Boolean(process.env.SKIP_DEPLOY))(destroy(Stack));

const getJson = <T>(url: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url);
      return { status: response.status, body: (await response.json()) as T };
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

const getPage = (url: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url);
      return {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        html: await response.text(),
      };
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

test(
  "worker serves health, catalog, and the dashboard",
  Effect.gen(function* () {
    const { url } = yield* deployed;
    const origin = String(url).replace(/\/$/, "");
    if (!origin) {
      return yield* Effect.fail(new Error("STACK_URL is required when SKIP_DEPLOY is set."));
    }

    const health = yield* getJson<{ status?: string }>(`${origin}/api/health`);
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");

    const catalog = yield* getJson<{ providers?: unknown[] }>(`${origin}/api/catalog`);
    expect(catalog.status).toBe(200);
    expect(catalog.body.providers?.length).toBeGreaterThan(0);

    const page = yield* getPage(`${origin}/`);
    expect(page.status).toBe(200);
    expect(page.contentType).toContain("text/html");
    expect(page.html).toContain("EdgeSpec");
  }),
);
