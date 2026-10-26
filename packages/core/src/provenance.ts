/** The pull request body: what ran, what it measured, and what was never touched. */
import type { CheckKind, CoverageDelta, MutationResult } from "./types";

export interface ProvenanceCheck {
  name: string;
  kind: CheckKind | string;
  command: string;
  ok: boolean;
  skipped?: boolean;
  durationMs: number;
}

/** One generated test, with the facts the reviewer needs. */
export interface ProvenanceFile {
  sourcePath: string;
  testPath: string;
  provider?: string;
  model?: string;
  corrected?: boolean;
  /** The prompt version that produced the code. */
  promptVersion?: string;
  /** The suite passed and failed on identical input; never accepted as verified. */
  flaky?: boolean;
  /** `true` executed, `false` static only, absent not reported. */
  verified?: boolean;
  checks?: ProvenanceCheck[];
  coverage?: CoverageDelta;
  mutation?: MutationResult;
}

export interface SkippedContractOperation {
  method: string;
  path: string;
  reason: string;
}

export interface PullProvenance {
  provider?: string;
  model?: string;
  files: readonly ProvenanceFile[];
  skipped?: readonly SkippedContractOperation[];
  /** The caller enforces the test-only path policy. */
  testOnly?: boolean;
}

const MAX_FILES = 50;
const MAX_SKIPPED = 10;
const MAX_CHECKS = 30;

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function fileLine(file: ProvenanceFile): string {
  const verification = file.flaky
    ? "flaky, quarantined (not verified)"
    : file.verified === true
      ? "executed on the runner"
      : file.verified === false
        ? "static check only"
        : "verification not reported";
  const checks = file.checks?.length ? ` · ${file.checks.length} check(s)` : "";
  const coverage =
    file.coverage?.status === "measured"
      ? ` · coverage ${signed(file.coverage.lines.delta)} lines`
      : "";
  const mutation =
    file.mutation?.status === "measured"
      ? ` · mutation ${file.mutation.score}%`
      : file.mutation?.status === "not-measured"
        ? " · mutation not measured"
        : "";
  return `- \`${file.sourcePath}\` → \`${file.testPath}\`: ${verification}${checks}${coverage}${mutation}.`;
}

function coverageLine(file: ProvenanceFile): string {
  const coverage = file.coverage;
  if (!coverage || coverage.status !== "measured") return "";
  const branches = coverage.branches
    ? `, ${signed(coverage.branches.delta)} branches (${coverage.branches.after}/${coverage.branches.total})`
    : "";
  return `- \`${file.sourcePath}\`: ${signed(coverage.lines.delta)} covered lines (${coverage.lines.after}/${coverage.lines.total})${branches}.`;
}

/** Deterministic body: the same run facts produce the same text. */
export function pullRequestBody(input: PullProvenance): string {
  const files = input.files.slice(0, MAX_FILES);
  const model = [input.provider?.trim(), input.model?.trim()].filter(Boolean).join(" · ");
  const executed = files.filter((file) => file.verified === true).length;
  const staticOnly = files.filter((file) => file.verified === false).length;
  const unreported = files.filter((file) => file.verified === undefined).length;
  const corrected = files.filter((file) => file.corrected);
  const flaky = files.filter((file) => file.flaky).length;
  const coverageLines = files.map(coverageLine).filter(Boolean);
  const mutationLines = files.flatMap((file) => {
    const mutation = file.mutation;
    if (!mutation) return [];
    if (mutation.status === "not-measured") {
      return [
        `- \`${file.sourcePath}\`: not measured${mutation.reason ? ` · ${mutation.reason}` : ""}.`,
      ];
    }
    return [
      `- \`${file.sourcePath}\`: ${mutation.score}% · ${mutation.killed} killed / ${mutation.survived} survived${mutation.budgetStopped ? " · budget stop" : ""} · \`${mutation.command}\`.`,
    ];
  });

  const checks = new Map<string, ProvenanceCheck>();
  for (const file of files) {
    for (const check of file.checks ?? []) {
      const key = `${check.kind}:${check.name}:${check.command}`;
      if (!checks.has(key)) checks.set(key, check);
    }
  }
  const checkLines = [...checks.values()]
    .slice(0, MAX_CHECKS)
    .map(
      (check) =>
        `- \`${check.name || check.kind}\` (${check.command}) · ${check.durationMs} ms · ${
          check.skipped ? "skipped" : check.ok ? "passed" : "failed"
        }.`,
    );

  const skipped = input.skipped ?? [];
  const skippedLines = skipped
    .slice(0, MAX_SKIPPED)
    .map((item) => `- \`${item.method} ${item.path}\`: ${item.reason}.`);

  const promptVersion = files.find((file) => file.promptVersion)?.promptVersion;
  const summary: string[] = [];
  if (model) summary.push(`Generated with ${model}.`, "");
  if (promptVersion) summary.push(`- Prompt version: ${promptVersion}.`, "");
  summary.push(...files.map((file) => `- \`${file.testPath}\` for \`${file.sourcePath}\`.`));
  if (files.length === 0) summary.push("- No files were reported.");

  return [
    "## Summary",
    "",
    ...summary,
    "",
    "## Verification",
    "",
    `- ${executed} executed on the runner, ${staticOnly} static only${
      unreported > 0 ? `, ${unreported} not reported` : ""
    }.`,
    ...files.map(fileLine),
    ...(flaky > 0 ? [`- ${flaky} test(s) are flaky and quarantined.`] : []),
    "",
    "## Checks",
    "",
    ...(checkLines.length > 0 ? checkLines : ["- No repository check details were reported."]),
    "",
    "## Coverage",
    "",
    ...(coverageLines.length > 0 ? coverageLines : ["- Not measured: no two LCOV reports."]),
    "",
    "## Mutation",
    "",
    ...(mutationLines.length > 0
      ? mutationLines
      : ["- Not measured: no mutation command was configured or no tool ran."]),
    "",
    "## Corrections",
    "",
    ...(corrected.length > 0
      ? corrected.map((file) => `- \`${file.sourcePath}\` was self-corrected after a failed check.`)
      : ["- No file needed self-correction."]),
    "",
    "## Contract operations",
    "",
    ...(skippedLines.length > 0
      ? [
          `- ${skipped.length} operation(s) skipped:`,
          ...skippedLines,
          ...(skipped.length > MAX_SKIPPED ? [`- …and ${skipped.length - MAX_SKIPPED} more.`] : []),
        ]
      : ["- No contract operations were skipped."]),
    "",
    "## Safety",
    "",
    ...(input.testOnly === false
      ? ["- The test-only guard was not reported for this request."]
      : [
          "- Only test artifacts were written (`*.test.*`, `*.spec.*`, `tests/**`, `__tests__/**`).",
          "- Application source was not modified.",
        ]),
    "",
  ].join("\n");
}
