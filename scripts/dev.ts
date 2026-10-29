/**
 * One development stack: API on :8787 and the dashboard on :5173.
 */
const commands: Array<[string, string[]]> = [
  ["worker", ["bun", "run", "dev:worker"]],
  ["web", ["bun", "run", "dev"]],
];

const children = commands.map(([name, cmd]) => {
  const child = Bun.spawn(cmd, {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return { name, child };
});

const shutdown = () => {
  for (const { child } of children) child.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const exitCode = await Promise.race(children.map(({ child }) => child.exited));
for (const { child } of children) child.kill();
process.exit(exitCode ?? 0);

export {};
