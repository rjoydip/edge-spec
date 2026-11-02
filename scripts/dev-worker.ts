/**
 * Worker dev stack: watch build + `alchemy dev`.
 *
 * The Vite watch starts first and we wait for its "watching for file changes"
 * line before starting Alchemy. Otherwise Alchemy serves the last bundle
 * immediately, edits made before the watcher is armed are missed, and the
 * reload looks broken. Alchemy watches `dist/worker/index.js` (the stack uses
 * `main` + `bundle: false`) and reloads on each rebuild.
 *
 * The docs site runs alongside the Worker so the stack's local `docsUrl`
 * (`http://127.0.0.1:5174`) is reachable while the app is running.
 */
const WATCH_READY = "watching for file changes";

const watch = Bun.spawn(["bun", "run", "--cwd", "apps/worker", "watch"], {
  stdout: "pipe",
  stderr: "pipe",
  stdin: "ignore",
});

let ready = false;
let readyResolve: () => void = () => {};
const readyPromise = new Promise<void>((resolve) => {
  readyResolve = resolve;
});

const pump = async (stream: ReadableStream<Uint8Array>) => {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    const text = decoder.decode(chunk);
    process.stdout.write(text);
    if (!ready && text.includes(WATCH_READY)) {
      ready = true;
      readyResolve();
    }
  }
};
void pump(watch.stdout as ReadableStream<Uint8Array>);
void pump(watch.stderr as ReadableStream<Uint8Array>);

const waitReady = async (): Promise<boolean> => {
  const timeout = Bun.sleep(120_000).then(() => "timeout" as const);
  const exited = watch.exited.then(() => "exited" as const);
  const result = await Promise.race([readyPromise.then(() => "ready" as const), timeout, exited]);
  return result === "ready";
};

if (!(await waitReady())) {
  console.error("Worker watch build did not become ready; not starting alchemy dev.");
  watch.kill();
  process.exit(1);
}

/**
 * Kill the whole tree: on Windows `child.kill()` leaves alchemy/workerd
 * grandchildren alive, and a stale worker holds port 8787 so the next
 * `alchemy dev` cannot bind (and never reloads).
 */
const stop = (child: { pid?: number; kill: () => void }) => {
  if (process.platform === "win32" && child.pid) {
    Bun.spawnSync(["cmd", "/c", "taskkill", "/PID", String(child.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } else {
    child.kill();
  }
};

// A stale alchemy/workerd tree silently owns the port and makes reload look
// broken. Fail with a clear message instead of starting a dead instance.
const occupied = await fetch("http://127.0.0.1:8787/api/health")
  .then((response) => response.ok)
  .catch(() => false);
if (occupied) {
  console.error(
    "Port 8787 already answers /api/health. Stop the other dev server first " +
      "(netstat -ano | findstr 8787, then taskkill /PID <pid> /T /F).",
  );
  stop(watch);
  process.exit(1);
}

const alchemy = Bun.spawn(["bun", "run", "--cwd", "infra/cloudflare", "dev"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "ignore",
});

// The stack reports `http://127.0.0.1:5174` as docsUrl in dev; serve it.
const docs = Bun.spawn(["bun", "run", "docs:dev"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "ignore",
});

// The stack reports `http://127.0.0.1:5175` as wwwUrl in dev; serve it.
const www = Bun.spawn(["bun", "run", "dev:www"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "ignore",
});

const shutdown = () => {
  stop(alchemy);
  stop(docs);
  stop(www);
  stop(watch);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const exitCode = await Promise.race([watch.exited, alchemy.exited, docs.exited, www.exited]);
shutdown();
process.exit(exitCode ?? 1);

export {};
