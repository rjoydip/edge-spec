/** Approved per-repository conventions. Short strings only, never source. */

export interface RepoMemory {
  /** Human-approved conventions, e.g. "tests use the repository's test helper". */
  conventions?: string[];
  /** Test helper modules the model may import. */
  helpers?: string[];
  /** Fixture paths or names that already exist. */
  fixtures?: string[];
  /** The repository's test naming/path convention. */
  naming?: string;
}

const stringsOf = (value: unknown, max = 20): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, max)
        .map((item) => item.slice(0, 300))
    : [];

/** Accepts only known fields, drops empty values and caps every list. */
export function parseRepoMemory(value: unknown): RepoMemory {
  const input =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const conventions = stringsOf(input.conventions);
  const helpers = stringsOf(input.helpers);
  const fixtures = stringsOf(input.fixtures);
  const naming = typeof input.naming === "string" ? input.naming.trim().slice(0, 200) : "";
  return {
    ...(conventions.length > 0 ? { conventions } : {}),
    ...(helpers.length > 0 ? { helpers } : {}),
    ...(fixtures.length > 0 ? { fixtures } : {}),
    ...(naming ? { naming } : {}),
  };
}

/** One bounded prompt section from approved memory; empty when nothing is set. */
export function memoryPrompt(memory: RepoMemory | undefined): string {
  if (!memory) return "";
  const lines = [
    ...(memory.naming ? [`- Naming: ${memory.naming}`] : []),
    ...(memory.conventions ?? []).map((item) => `- Convention: ${item}`),
    ...(memory.helpers ?? []).map((item) => `- Existing helper: ${item}`),
    ...(memory.fixtures ?? []).map((item) => `- Existing fixture: ${item}`),
  ];
  return lines.length > 0
    ? `\nApproved repository memory (use it, do not invent around it):\n${lines.join("\n")}\n`
    : "";
}
