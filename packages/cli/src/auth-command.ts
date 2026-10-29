/** `edge-spec auth`: device-flow login against the dashboard. */
import {
  authorizeUrl,
  clearCredentials,
  decryptProfile,
  envDefaults,
  generatePayloadKey,
  openBrowser,
  pollDeviceFlow,
  readCredentials,
  startDeviceFlow,
  writeCredentials,
  type AuthFile,
  type DevicePollResult,
  type Env,
} from "@edge-spec/client";

const POLL_INTERVAL_MS = 2_000;
const POLL_DEADLINE_MS = 15 * 60 * 1000;

const stdout = (text: string): void => {
  process.stdout.write(`${text.endsWith("\n") ? text : `${text}\n`}`);
};

const stderr = (text: string): void => {
  process.stderr.write(`${text.endsWith("\n") ? text : `${text}\n`}`);
};

const mask = (value: string): string =>
  value.length <= 12
    ? "•".repeat(Math.max(value.length, 3))
    : `${value.slice(0, 10)}…${value.slice(-4)}`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const login = async (env: Env, options: { url?: string; json: boolean }): Promise<boolean> => {
  const defaults = envDefaults(env);
  const baseUrl = (options.url ?? defaults.baseUrl).replace(/\/+$/, "");
  const existing = readCredentials();
  if (existing && existing.workspace === baseUrl) {
    stderr(`Already authorized with ${baseUrl}. Run "edge-spec auth logout" to reset.`);
    if (options.json) stdout(JSON.stringify({ status: "authorized", workspace: baseUrl }));
    return true;
  }

  const start = await startDeviceFlow(baseUrl);
  const payloadKey = generatePayloadKey();
  const url = authorizeUrl(baseUrl, start.userCode, payloadKey);

  stderr(
    [
      `Authorize this device on ${baseUrl}:`,
      "",
      `  1. Open:  ${url}`,
      `  2. Accept the code shown here:`,
      "",
      `     ${start.userCode}`,
      "",
      `  3. Choose "Authorize" to hand this profile to the CLI. Waiting…`,
    ].join("\n"),
  );
  openBrowser(url);
  const deadline = Date.now() + POLL_DEADLINE_MS;
  let last: DevicePollResult | undefined;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    last = await pollDeviceFlow(baseUrl, start.deviceCode);
    if (last.status !== "pending") break;
  }
  if (!last || last.status === "pending") {
    stderr("Timed out waiting for authorization. Run the command again.");
    return false;
  }
  if (last.status === "expired") {
    stderr("The authorization request expired. Run the command again.");
    return false;
  }
  const profile = (await decryptProfile(last.profile ?? "", payloadKey)) as AuthFile["profile"];
  writeCredentials({
    workspace: last.workspace || baseUrl,
    token: last.token ?? "",
    authorizedAt: Date.now(),
    profile,
  });
  if (options.json) {
    stdout(
      JSON.stringify({
        status: "authorized",
        workspace: last.workspace || baseUrl,
        token: mask(last.token ?? ""),
      }),
    );
    return true;
  }
  stderr(
    [
      `Authorized ${last.workspace || baseUrl}.`,
      "Stored secrets stay request headers; your shell env always wins.",
    ].join("\n"),
  );
  return true;
};

const status = (json: boolean): boolean => {
  const stored = readCredentials();
  if (!json) {
    if (!stored) {
      stderr("Not signed in. Run `edge-spec auth login`.");
      return false;
    }
    const profile = stored.profile;
    stderr(
      [
        `Workspace: ${stored.workspace}`,
        `Authorized: ${new Date(stored.authorizedAt).toISOString()}`,
        `Token: ${mask(stored.token)}`,
        `GitHub token: ${profile.githubToken ? mask(profile.githubToken) : "—"}`,
        `AI key: ${profile.aiKey ? mask(profile.aiKey) : "—"}`,
        `Sandbox: ${profile.sandboxUrl ? `${profile.sandboxUrl}` : "—"}`,
      ].join("\n"),
    );
    return true;
  }
  stdout(
    JSON.stringify({
      status: stored ? "authorized" : "signed-out",
      ...(stored ? { workspace: stored.workspace, authorizedAt: stored.authorizedAt } : {}),
    }),
  );
  return Boolean(stored);
};

export const runAuth = async (
  action: "login" | "status" | "logout",
  env: Env,
  options: { url?: string; json: boolean },
): Promise<void> => {
  if (action === "login") {
    if (!(await login(env, options))) process.exitCode = 1;
    return;
  }
  if (action === "status") {
    if (!status(options.json)) process.exitCode = 1;
    return;
  }
  clearCredentials();
  stderr(
    options.json ? JSON.stringify({ status: "signed-out" }) : "Removed the stored authorization.",
  );
};
