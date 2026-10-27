/** A pull-request check: changed-file gaps plus the affected tests we could run. */
import type { Gap } from "./types";

export interface PrCheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  level: "notice" | "warning" | "failure";
  title: string;
  message: string;
}

export interface PrCheckResult {
  conclusion: "success" | "neutral" | "failure";
  output: {
    title: string;
    summary: string;
    annotations: PrCheckAnnotation[];
  };
  /** One comment body; it carries a marker so a re-run updates it. */
  comment: string;
}

export const PR_CHECK_MARKER = "<!-- edgespec:pr-check -->";
export const PR_CHECK_NAME = "EdgeSpec / tests";
const MAX_ANNOTATIONS = 50;
const MAX_MESSAGE = 500;

export interface PrCheckInput {
  changedFiles: readonly string[];
  /** Changed sources that have no test anywhere a convention looks. */
  gaps: readonly Gap[];
  /** Existing tests for the changed sources, or changed test files. */
  affectedTests: readonly string[];
  /** False when no sandbox is configured; the check is static only. */
  runner: boolean;
  /** `executed: false` means the runner was configured but could not run. */
  testRun?: { ok: boolean; output: string; durationMs: number; executed?: boolean };
  /** Why each test was selected, from the import graph. */
  impact?: ReadonlyArray<{ test: string; via: string[] }>;
  /** The graph fetch was bounded; some dependents may be absent. */
  partialImpact?: boolean;
}

function clip(value: string, max = MAX_MESSAGE): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Deterministic check output. The same facts produce the same body. */
export function buildPrCheck(input: PrCheckInput): PrCheckResult {
  const annotations: PrCheckAnnotation[] = input.gaps.slice(0, MAX_ANNOTATIONS).map((gap) => ({
    path: gap.path,
    start_line: 1,
    end_line: 1,
    level: input.runner ? "warning" : "notice",
    title: input.runner ? "No test found" : "No test found · static only",
    message: clip(
      input.runner
        ? `No test file was found for this source, so the changed file has no executed coverage. Expected something like ${gap.testPath}.`
        : `No test file was found for this source. No runner is configured, so this is a static check only, not a test result.`,
    ),
  }));

  const executed = Boolean(input.testRun) && input.testRun?.executed !== false;

  if (input.testRun && executed && !input.testRun.ok) {
    annotations.push({
      path: input.affectedTests[0] ?? "tests",
      start_line: 1,
      end_line: 1,
      level: "failure",
      title: "Affected tests failed",
      message: clip(input.testRun.output || "The runner returned a failure without output."),
    });
  }

  const testLine = input.testRun
    ? executed
      ? `- ${input.affectedTests.length} affected test file(s) ran on the runner · ${
          input.testRun.ok ? "passed" : "failed"
        } in ${input.testRun.durationMs} ms.`
      : "- The runner could not execute the affected tests. This is a static check only."
    : input.affectedTests.length > 0
      ? "- No runner is configured; the affected tests were not executed. This is a static check only."
      : "- No affected test file was found for the changed sources.";

  const gapLines = input.gaps
    .slice(0, 20)
    .map((gap) => `- \`${gap.path}\` — expected \`${gap.testPath}\`.`);
  if (input.gaps.length > 20) gapLines.push(`- …and ${input.gaps.length - 20} more.`);

  const impactLines =
    input.impact && input.impact.length > 0
      ? input.impact
          .slice(0, 20)
          .map(
            (item) => `- \`${item.test}\` ← ${item.via.map((path) => `\`${path}\``).join(" → ")}.`,
          )
      : ["- No test dependent was selected."];
  if (input.impact && input.impact.length > 20) {
    impactLines.push(`- …and ${input.impact.length - 20} more.`);
  }
  if (input.partialImpact) {
    impactLines.push("- Partial graph: the source fetch was bounded.");
  }

  const summary = [
    "## EdgeSpec check",
    "",
    `- ${input.changedFiles.length} changed file(s); ${input.gaps.length} changed source(s) have no test.`,
    testLine,
    "- Changed-file scope; test dependents come from the import graph.",
    "",
    "### Impact",
    "",
    ...impactLines,
    "",
    "### Gaps",
    "",
    ...(gapLines.length > 0 ? gapLines : ["- None in the changed files."]),
    "",
    input.runner
      ? "No commit or pull request was created. This check is advisory."
      : "No runner means static only, never passed. No commit or pull request was created.",
  ].join("\n");

  const conclusion =
    input.testRun && executed && !input.testRun.ok
      ? "failure"
      : input.gaps.length > 0 || !input.runner || Boolean(input.testRun && !executed)
        ? "neutral"
        : "success";

  return {
    conclusion,
    output: {
      title:
        conclusion === "failure"
          ? "Affected tests failed"
          : conclusion === "neutral"
            ? input.runner
              ? "Changed files need tests"
              : "Static check only"
            : "Changed files are covered",
      summary,
      annotations: annotations.slice(0, MAX_ANNOTATIONS),
    },
    comment: `${PR_CHECK_MARKER}\n${summary}`,
  };
}
