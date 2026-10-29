/**
 * Bun/Node entry: same app, adapters from `process.env`, optional static files
 * and an optional interval cron. Run with `bun run serve`.
 */
import { resolve, sep } from "node:path";
import { app } from "./app";
import { runScheduled } from "./scheduled";
import { platformFromEnv } from "./adapters/node";

const env = await platformFromEnv(process.env);
const port = Number(process.env.PORT ?? 8787);
const root = resolve(process.env.EDGESPEC_STATIC_DIR?.trim() || "dist/web");

async function staticFile(pathname: string): Promise<Response | undefined> {
  const candidate = resolve(root, `.${pathname}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) return undefined;
  const file = Bun.file(candidate);
  if (await file.exists()) return new Response(file);
  const index = Bun.file(resolve(root, "index.html"));
  if (await index.exists()) return new Response(index);
  return undefined;
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    // API and webhook routes belong to the app, never to the SPA fallback.
    const appRoute =
      pathname === "/api" ||
      pathname.startsWith("/api/") ||
      pathname === "/webhook" ||
      pathname === "/auth" ||
      pathname.startsWith("/auth/");
    if (!appRoute && (request.method === "GET" || request.method === "HEAD")) {
      const file = await staticFile(pathname);
      if (file) return file;
    }
    return app.fetch(request, env);
  },
});

console.log(`EdgeSpec listening on http://127.0.0.1:${server.port}`);

const minutes = Number(process.env.EDGESPEC_CRON_INTERVAL_MINUTES ?? "");
if (Number.isFinite(minutes) && minutes > 0) {
  setInterval(() => {
    runScheduled({ scheduledTime: Date.now(), cron: "interval" }, env, {
      waitUntil: () => {},
    }).catch((error: unknown) => console.error("Scheduled run failed:", error));
  }, minutes * 60_000);
}
