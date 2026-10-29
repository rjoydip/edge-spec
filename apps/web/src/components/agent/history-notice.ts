import type { DeploymentCapabilities } from "@/api";

/**
 * Copy for a disabled history endpoint. `/api/health` says whether a database
 * is bound, so the notice names the real gap instead of telling every host to
 * add a D1 binding.
 */
export function historyNotice(capabilities?: DeploymentCapabilities): string {
  if (!capabilities) return "Not enabled on this deployment.";
  if (capabilities.history) return "History is not enabled for this workspace.";
  return "Not enabled on this deployment: no history database is bound. Bind DB or RUNS_DB, or set EDGESPEC_DB_URL and run `bun run migrate`.";
}
