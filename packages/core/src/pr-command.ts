/** Parsing and authorization for `/edgespec <command>` pull-request comments. */

export type PrCommandName = "retest" | "coverage" | "explain";

export interface PrCommand {
  name: PrCommandName;
  argument?: string;
}

/** `explain` needs a target; the other commands take no argument. */
export function parsePrCommand(body: string): PrCommand | undefined {
  const match = /^\/edgespec\s+(retest|coverage|explain)(?:\s+([\s\S]+))?$/i.exec(body.trim());
  if (!match) return undefined;
  const name = (match[1] ?? "").toLowerCase() as PrCommandName;
  const argument = match[2]?.trim().slice(0, 200);
  if (name === "explain" && !argument) return undefined;
  if (name !== "explain" && argument) return undefined;
  return { name, ...(argument ? { argument } : {}) };
}

/**
 * Only repository owners, members and collaborators may spend a command.
 * Bots are ignored even when they somehow carry a collaborator association.
 */
export function authorizedCommenter(input: { association?: string; userType?: string }): boolean {
  if (input.userType === "Bot") return false;
  return ["OWNER", "MEMBER", "COLLABORATOR"].includes(input.association ?? "");
}
