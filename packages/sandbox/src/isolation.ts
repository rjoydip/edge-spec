/**
 * The isolation boundary. `/run` refuses to execute anything unless this
 * produces a real wrapper: running generated code on a host is not a sandbox.
 */
import { existsSync } from "node:fs";
import path from "node:path";

export interface Isolation {
  kind: "bwrap" | "none";
  reason?: string;
  wrap(argv: string[], options: { workdir: string; env: Record<string, string> }): string[];
}

export interface BwrapInput {
  bwrap: string;
  workdir: string;
  argv: string[];
  env: Record<string, string>;
  egress: boolean;
  roBinds: string[];
}

/**
 * Builds the bwrap argv. The workdir is the only writable host path; every
 * runtime directory is read-only, the network namespace is empty unless egress
 * was opted into, and the child inherits no host environment.
 */
export function bwrapArgs(input: BwrapInput): string[] {
  const args = [
    input.bwrap,
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--clearenv",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--bind",
    input.workdir,
    input.workdir,
    "--chdir",
    input.workdir,
  ];
  // --unshare-all already drops the network; egress is a deliberate opt-in.
  if (input.egress) args.push("--share-net");
  for (const dir of input.roBinds) args.push("--ro-bind", dir, dir);
  for (const [key, value] of Object.entries(input.env)) args.push("--setenv", key, value);
  args.push("--", ...input.argv);
  return args;
}

/** Runtime directories a child needs; each is mounted read-only. */
export function defaultRoBinds(): string[] {
  const candidates = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/lib32", "/etc"];
  // Bun itself usually lives outside /usr.
  candidates.push(path.dirname(process.execPath));
  return [...new Set(candidates)].filter((dir) => existsSync(dir));
}

export function detectIsolation(env: Record<string, string | undefined> = process.env): Isolation {
  const unisolated: Isolation = {
    kind: "none",
    reason: "No isolation. Set SANDBOX_ALLOW_UNISOLATED=1 to run anyway (never on a shared host).",
    wrap: (argv) => argv,
  };
  if (process.platform !== "linux") {
    return {
      ...unisolated,
      reason: `bwrap needs Linux or WSL2; this is ${process.platform}. ${unisolated.reason}`,
    };
  }
  const bwrap = Bun.which("bwrap");
  if (!bwrap)
    return {
      ...unisolated,
      reason: `bwrap is not installed. ${unisolated.reason}`,
    };

  const egress = env.SANDBOX_ALLOW_EGRESS === "1";
  const roBinds = defaultRoBinds();
  return {
    kind: "bwrap",
    ...(egress ? { reason: "Egress is enabled (SANDBOX_ALLOW_EGRESS=1)." } : {}),
    wrap: (argv, options) =>
      bwrapArgs({
        bwrap,
        workdir: options.workdir,
        argv,
        env: options.env,
        egress,
        roBinds,
      }),
  };
}
