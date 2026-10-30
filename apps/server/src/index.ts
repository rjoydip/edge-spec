/**
 * Bun/Node HTTP entry — the shared Docker image for Fly, Railway, Docker and
 * Kubernetes runs this file. It owns the things a packet server owns: static
 * files, the listening socket and the optional interval cron. The Hono app and
 * every capability come from packages.
 *
 * The listening line is printed only for loopback hosts: on a real deployment
 * the process manager already reports the URL, and a container log line per
 * boot is noise. `HOST=127.0.0.1` (or `EDGESPEC_LOCAL=1`) makes it local.
 */
import { resolve, sep } from "node:path";
import consola from "consola";
import { app } from "@edge-spec/runtime/app";
import { runScheduled } from "@edge-spec/runtime/scheduled";
import { platformFromEnv } from "@edge-spec/adapters/node";
import { observerFor } from "@edge-spec/runtime/observability";

const env = await platformFromEnv(process.env);
const observer = observerFor(env);
const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST?.trim() || "0.0.0.0";
const root = resolve(process.env.EDGESPEC_STATIC_DIR?.trim() || "dist/web");
const local =
  /^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(hostname) ||
  /^(1|true)$/i.test(process.env.EDGESPEC_LOCAL ?? "");

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
  hostname,
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

if (local) {
  consola.success(`EdgeSpec listening on http://${hostname}:${server.port}`);
}
observer.log("info", "server.started", { port: server.port, local });

const minutes = Number(process.env.EDGESPEC_CRON_INTERVAL_MINUTES ?? "");
if (Number.isFinite(minutes) && minutes > 0) {
  setInterval(() => {
    runScheduled({ scheduledTime: Date.now(), cron: "interval" }, env, {
      waitUntil: () => {},
    }).catch((error: unknown) => {
      consola.error("Scheduled run failed", error);
      void observer.error(error, { job: "scheduled" });
    });
  }, minutes * 60_000);
}
