/**
 * Worker dev stack: a watch build of the Worker bundle plus `alchemy dev`.
 *
 * `alchemy dev` serves `dist/worker/index.js` and reloads when that file
 * changes; it cannot rebuild the Vite bundle itself. The watch process does
 * exactly that, so editing `packages/*` or `apps/worker` reloads the local
 * Worker. Run `bun run dev` alongside it for the dashboard (or `dev:all`).
 */
const commands: Array<[string, string[]]> = [
  ["worker", ["bun", "run", "--cwd", "apps/worker", "watch"]],
  ["alchemy", ["bun", "run", "--cwd", "infra/cloudflare", "dev"]],
];

const children = commands.map(([name, cmd]) => ({
  name,
  child: Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit", stdin: "ignore" }),
}));

/**
 * Kill the whole tree: on Windows `child.kill()` leaves the alchemy/workerd
 * grandchildren alive, and a stale worker then holds port 8787 so the next
 * `alchemy dev` silently fails to bind (and never reloads).
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

const shutdown = () => {
  for (const { child } of children) stop(child);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const exitCode = await Promise.race(children.map(({ child }) => child.exited));
for (const { child } of children) stop(child);
process.exit(exitCode ?? 0);
