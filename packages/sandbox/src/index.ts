/**
 * The self-hosted runner. `bun run sandbox` starts this on 127.0.0.1:8788.
 * It speaks the v1/v2 HTTP contract and refuses to execute without an
 * isolation boundary (bwrap, Docker, Podman, E2B, Vercel or Daytona).
 */
import type { SandboxRequest } from "@edge-spec/core/sandbox";
import {
  DEFAULT_IMAGE,
  bwrapDriver,
  containerDriver,
  detectDriverKind,
  driverHealth,
  hostDriver,
  providerMismatch,
  type Driver,
  type DriverContext,
  type DriverKind,
} from "./driver";
import { detectIsolation } from "./isolation";
import { createE2bDriver, e2bHealth, type E2bConfig } from "./e2b";
import { createVercelDriver, vercelHealth, type VercelConfig } from "./vercel";
import { createDaytonaDriver, daytonaHealth, type DaytonaConfig } from "./daytona";
import { runInWorkspace } from "./run";

const VERSION = "0.1.0";
const hostname = process.env.SANDBOX_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.SANDBOX_PORT ?? 8788);
const apiKey = process.env.SANDBOX_API_KEY?.trim();
const isolation = detectIsolation();
const allowUnisolated = process.env.SANDBOX_ALLOW_UNISOLATED === "1";
const requested = process.env.SANDBOX_PROVIDER?.trim().toLowerCase() || "auto";
const image = process.env.SANDBOX_IMAGE?.trim() || DEFAULT_IMAGE;
const e2b: E2bConfig = {
  apiKey: process.env.E2B_API_KEY?.trim(),
  template: process.env.E2B_TEMPLATE?.trim(),
  timeoutMs: Number(process.env.E2B_TIMEOUT_MS ?? 600_000),
};
const vercel: VercelConfig = {
  token: process.env.VERCEL_TOKEN?.trim(),
  teamId: process.env.VERCEL_TEAM_ID?.trim(),
  projectId: process.env.VERCEL_PROJECT_ID?.trim(),
  image: process.env.VERCEL_SANDBOX_IMAGE?.trim(),
  timeoutMs: Number(process.env.VERCEL_SANDBOX_TIMEOUT_MS ?? 900_000),
};
const daytona: DaytonaConfig = {
  apiKey: process.env.DAYTONA_API_KEY?.trim(),
  apiUrl: process.env.DAYTONA_API_URL?.trim(),
  target: process.env.DAYTONA_TARGET?.trim(),
  snapshot: process.env.DAYTONA_SNAPSHOT?.trim(),
  image: process.env.DAYTONA_IMAGE?.trim(),
  timeoutMs: Number(process.env.DAYTONA_TIMEOUT_MS ?? 900_000),
};

if (!["auto", "bwrap", "docker", "podman", "e2b", "vercel", "daytona"].includes(requested)) {
  console.error(
    `Unknown SANDBOX_PROVIDER "${requested}". Use auto, bwrap, docker, podman, e2b, vercel or daytona.`,
  );
  process.exit(1);
}
const kind: DriverKind = detectDriverKind(requested, isolation);
if (kind === "bwrap" && isolation.kind !== "bwrap") {
  console.error(`SANDBOX_PROVIDER=bwrap but bwrap is not usable: ${isolation.reason ?? "unknown"}`);
  process.exit(1);
}
if (kind === "e2b" && !e2b.apiKey) {
  console.error("SANDBOX_PROVIDER=e2b requires E2B_API_KEY on the runner.");
  process.exit(1);
}
if (kind === "vercel" && (!vercel.token || !vercel.teamId || !vercel.projectId)) {
  console.error(
    "SANDBOX_PROVIDER=vercel requires VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID on the runner.",
  );
  process.exit(1);
}
if (kind === "daytona" && !daytona.apiKey) {
  console.error("SANDBOX_PROVIDER=daytona requires DAYTONA_API_KEY on the runner.");
  process.exit(1);
}
if (kind === "docker" || kind === "podman") {
  if (!Bun.which(kind)) {
    console.error(`SANDBOX_PROVIDER=${kind} but the ${kind} binary is not on PATH.`);
    process.exit(1);
  }
}

const loopback = ["127.0.0.1", "localhost", "::1"].includes(hostname);
if (!loopback && !apiKey) {
  console.error(
    `Refusing to bind ${hostname} without SANDBOX_API_KEY: an unauthenticated runner executes arbitrary code.`,
  );
  process.exit(1);
}

if (kind === "none" && !allowUnisolated) {
  console.warn(`Isolation is off: ${isolation.reason}`);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authorized(request: Request): boolean {
  if (!apiKey) return true;
  return request.headers.get("authorization") === `Bearer ${apiKey}`;
}

function createDriver(context: DriverContext): Driver {
  if (kind === "bwrap") return bwrapDriver(context, isolation);
  if (kind === "none") return hostDriver(context);
  if (kind === "e2b") return createE2bDriver(context, e2b);
  if (kind === "vercel") return createVercelDriver(context, vercel);
  if (kind === "daytona") return createDaytonaDriver(context, daytona);
  return containerDriver(kind, context, { image });
}

function driverStatus(kind: DriverKind) {
  if (kind === "e2b") return e2bHealth(e2b);
  if (kind === "vercel") return vercelHealth(vercel);
  if (kind === "daytona") return daytonaHealth(daytona);
  return driverHealth(kind);
}

const server = Bun.serve({
  hostname,
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const isolationKind =
      kind === "bwrap"
        ? "namespace"
        : kind === "e2b" || kind === "vercel" || kind === "daytona"
          ? "vm"
          : kind === "none"
            ? "none"
            : "container";

    if (request.method === "GET" && url.pathname === "/health") {
      const mismatch = providerMismatch(request.headers.get("x-sandbox-provider"), kind);
      if (mismatch) {
        return json({
          ok: false,
          version: VERSION,
          provider: kind,
          isolation: isolationKind,
          error: mismatch,
        });
      }
      const health = await driverStatus(kind);
      return json({
        ok: health.ok,
        version: VERSION,
        capabilities: ["v1", "v2", "repo", "setup", "server", "env", "coverage"],
        provider: kind,
        isolation: isolationKind,
        ...(health.version ? { serverVersion: health.version } : {}),
        ...(health.error ? { error: health.error } : {}),
        ...(kind === "bwrap" && isolation.reason ? { reason: isolation.reason } : {}),
      });
    }
    if (request.method !== "POST" || url.pathname !== "/run") {
      return json({ error: "Not found." }, 404);
    }
    if (!authorized(request)) return json({ error: "Unauthorized." }, 401);

    const mismatch = providerMismatch(request.headers.get("x-sandbox-provider"), kind);
    if (mismatch) return json({ error: mismatch }, 409);

    if (kind === "none" && !allowUnisolated) {
      return json(
        {
          error:
            "No OS sandbox is available. Install bwrap on Linux, install Docker Desktop or Podman, or set SANDBOX_ALLOW_UNISOLATED=1 on a machine you do not share.",
        },
        503,
      );
    }
    if (kind === "docker" || kind === "podman") {
      const health = await driverHealth(kind);
      if (!health.ok) return json({ error: health.error }, 503);
    }
    if (kind === "e2b" || kind === "vercel" || kind === "daytona") {
      const health = await driverStatus(kind);
      if (!health.ok) return json({ error: health.error }, 503);
    }

    const text = await request.text();
    if (text.length > 11_000_000) return json({ error: "The request exceeds 10 MB." }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "The request body must be JSON." }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return json({ error: "The request body must be an object." }, 400);
    }

    try {
      return json(await runInWorkspace(body as SandboxRequest, { createDriver }));
    } catch (error) {
      return json(
        {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
          environmentError: "setup",
        },
        200,
      );
    }
  },
});

console.log(
  `EdgeSpec sandbox listening on http://${hostname}:${server.port} (provider: ${kind}${
    kind === "docker" || kind === "podman" ? `, image: ${image}` : ""
  })`,
);
