/**
 * One development stack: API on :8787, dashboard on :5173, and the Cloudflare
 * Sandbox bridge on :8788 when this host can build containers. Building them
 * needs Docker and a Linux host; Windows cannot run them under `wrangler dev`,
 * so there the bridge is skipped with the two supported alternatives.
 */
const canRunContainers =
  process.platform !== "win32" &&
  Bun.spawnSync(["docker", "version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

const commands: Array<[string, string[]]> = [
  ["worker", ["bun", "run", "dev:worker"]],
  ["web", ["bun", "run", "dev"]],
  ...(canRunContainers
    ? [["sandbox", ["bun", "run", "dev:sandbox-worker"]] as [string, string[]]]
    : []),
];

if (!canRunContainers) {
  console.log(
    [
      "Sandbox bridge not started: containers need Docker and a Linux host.",
      "Windows options:",
      "  1. Point Settings → Sandbox URL at a deployed bridge (bun run deploy:sandbox-worker).",
      "  2. Run `bun run dev:sandbox-worker` inside WSL2 with Docker Desktop.",
      "Without a runner, validation stays a static check.",
    ].join("\n"),
  );
}

const children = commands.map(([name, cmd]) => {
  const child = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  return { name, child };
});

const stop = () => {
  for (const { child } of children) child.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const exitCode = await Promise.race(children.map(({ child }) => child.exited));
for (const { child } of children) child.kill();
process.exit(exitCode ?? 0);
