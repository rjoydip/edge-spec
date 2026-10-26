/** Mutation reports from a tool that actually ran. Nothing here estimates. */
import type { MutationResult } from "./types";

/** `{file}`/`{test}` in the configured command are shell-quoted. */
export function mutationCommandFor(template: string, sourcePath: string, testPath: string): string {
  const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
  return template
    .replaceAll("{file}", quote(sourcePath))
    .replaceAll("{test}", quote(testPath))
    .trim();
}

const KILLED = new Set(["Killed", "Timeout"]);
const SURVIVED = new Set(["Survived", "NoCoverage"]);

function nonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

/**
 * Parses a Stryker JSON report (or a report exposing killed/survived totals).
 * A report with no valid mutants is "not measured", never 0 %.
 */
export function parseMutationReport(
  text: string,
  command: string,
  durationMs: number,
  options: { budgetStopped?: boolean } = {},
): MutationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      status: "not-measured",
      tool: "stryker",
      command,
      reason: "The mutation report was not JSON.",
    };
  }
  const record =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};

  let killed = nonNegative(record.killed);
  let survived = nonNegative(record.survived);
  const files = record.files;
  if (files && typeof files === "object") {
    for (const file of Object.values(files as Record<string, unknown>)) {
      const mutants =
        typeof file === "object" && file !== null
          ? (file as Record<string, unknown>).mutants
          : undefined;
      if (!Array.isArray(mutants)) continue;
      for (const mutant of mutants) {
        const status =
          typeof mutant === "object" && mutant !== null
            ? String((mutant as Record<string, unknown>).status ?? "")
            : "";
        if (KILLED.has(status)) killed += 1;
        else if (SURVIVED.has(status)) survived += 1;
      }
    }
  }

  const total = killed + survived;
  if (total === 0) {
    return {
      status: "not-measured",
      tool: "stryker",
      command,
      reason: "The mutation report had no valid mutants.",
    };
  }
  const reportedScore = Number(record.mutationScore);
  const score = Number.isFinite(reportedScore)
    ? Math.round(reportedScore * 10) / 10
    : Math.round((killed / total) * 1000) / 10;
  return {
    status: "measured",
    tool: "stryker",
    command,
    killed,
    survived,
    total,
    score,
    durationMs,
    ...(options.budgetStopped ? { budgetStopped: true } : {}),
  };
}
