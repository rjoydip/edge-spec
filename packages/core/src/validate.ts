/**
 * Validation. A real runner is optional: without one, EdgeSpec says so instead
 * of claiming a test passed.
 */
import { coverageDelta, type CoverageReport } from "./coverage";
import { mutationCommandFor, parseMutationReport } from "./mutation";
import type { CheckKind, CheckResult, MutationResult, Validation } from "./types";
import { runInSandbox, type SandboxConfig, type SandboxRepo } from "./sandbox";

export { runInSandbox } from "./sandbox";
export type { SandboxConfig } from "./sandbox";

/** A single-quoted shell word, so a repository path cannot inject a command. */
const shellWord = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

export interface StaticProblem {
  problem: string;
}

/** Deliberately shallow checks — a parser would be a dependency for little gain. */
export function staticCheck(test: string, strictTypes: boolean): StaticProblem[] {
  const problems: StaticProblem[] = [];
  const code = test.trim();

  if (code.length < 40) problems.push({ problem: "The generated file is too short to be a test." });
  if (/```/.test(code)) problems.push({ problem: "The file still contains a Markdown fence." });
  if (!/\b(describe|it|test)\s*\(/.test(code)) {
    problems.push({ problem: "No describe/it/test block found." });
  }
  if (!/\bexpect\s*\(/.test(code)) problems.push({ problem: "No expect() assertion found." });

  // ponytail: counts every brace, including those inside strings and comments.
  // A balanced-but-wrong file is caught later by the runner; upgrade to a real
  // parser only if the static path becomes the primary validator.
  for (const [open, close, label] of [
    ["{", "}", "braces"],
    ["(", ")", "parentheses"],
    ["[", "]", "brackets"],
  ] as const) {
    const opens = code.split(open).length - 1;
    const closes = code.split(close).length - 1;
    if (opens !== closes) {
      problems.push({ problem: `Unbalanced ${label}: ${opens} ${open} vs ${closes} ${close}.` });
    }
  }

  if (strictTypes) {
    if (/:\s*any\b/.test(code)) problems.push({ problem: "Strict mode: explicit `any` type." });
    if (/\bas\s+any\b/.test(code)) problems.push({ problem: "Strict mode: `as any` cast." });
    if (/@ts-(ignore|nocheck|expect-error)/.test(code)) {
      problems.push({ problem: "Strict mode: TypeScript suppression comment." });
    }
  }

  return problems;
}

export interface ValidateInput {
  sourcePath: string;
  source: string;
  testPath: string;
  test: string;
  strictTypes: boolean;
  sandbox?: SandboxConfig;
  /** The repository a v2 runner clones before writing the files. */
  repo?: SandboxRepo;
  /** Extra repeats after a passing run; 0 disables flaky detection. */
  flakyRuns?: number;
  /** A Stryker-compatible command; empty or absent means mutation is not measured. */
  mutationCommand?: string;
  /** Ask the runner for LCOV and attach a per-file delta to the result. */
  measureCoverage?: boolean;
  /** The before report; a delta needs both reports. */
  baselineCoverage?: CoverageReport;
  fetchImpl?: typeof fetch;
}

export async function validateTest(input: ValidateInput): Promise<Validation> {
  const started = Date.now();
  const problems = staticCheck(input.test, input.strictTypes);
  if (problems.length > 0) {
    return {
      ok: false,
      verified: false,
      output: problems.map((p) => `- ${p.problem}`).join("\n"),
      durationMs: Date.now() - started,
    };
  }

  if (!input.sandbox?.url?.trim()) {
    return {
      ok: true,
      verified: false,
      output:
        "Static checks passed. No sandbox runner is configured, so the suite was not executed.",
      durationMs: Date.now() - started,
    };
  }

  const run = await runInSandbox({
    sandbox: input.sandbox,
    ...(input.repo ? { repo: input.repo } : {}),
    files: {
      [input.sourcePath]: input.source,
      [input.testPath]: input.test,
    },
    command: input.repo ? `bun test ${shellWord(input.testPath)}` : "bun test",
    ...(input.measureCoverage ? { coverage: { format: "lcov" as const } } : {}),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
  const coverage = input.measureCoverage
    ? coverageDelta(input.baselineCoverage, run.coverage, input.sourcePath)
    : undefined;

  if (!run.ok && (run.unreachable || run.environmentError)) {
    return {
      ok: false,
      verified: false,
      output: run.output,
      durationMs: Date.now() - started,
      ...(coverage ? { coverage } : {}),
      ...(run.environmentError ? { environmentError: run.environmentError } : {}),
    };
  }

  // Repeat a passing suite; a pass/fail split is flaky, not verified.
  const firstOutput =
    run.output || (run.ok ? "bun test passed." : "bun test failed without output.");
  const extra = run.ok ? Math.min(5, Math.max(0, Math.round(input.flakyRuns ?? 0))) : 0;
  let runs = 1;
  let flaky = false;
  let repeatNote = "";
  for (let index = 0; index < extra; index += 1) {
    const repeat = await runInSandbox({
      sandbox: input.sandbox,
      ...(input.repo ? { repo: input.repo } : {}),
      files: {
        [input.sourcePath]: input.source,
        [input.testPath]: input.test,
      },
      command: input.repo ? `bun test ${shellWord(input.testPath)}` : "bun test",
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    runs += 1;
    if (repeat.unreachable || repeat.environmentError) {
      repeatNote = `Flaky repeats could not run: ${repeat.output}`;
      break;
    }
    if (!repeat.ok) {
      flaky = true;
      repeatNote = repeat.output;
      break;
    }
  }

  if (flaky) {
    return {
      ok: false,
      verified: false,
      flaky: true,
      runs,
      output:
        `Ran ${runs} time(s); the suite passed and failed on the same input. Flaky, quarantined.\n${repeatNote}`.trim(),
      durationMs: Date.now() - started,
      ...(coverage ? { coverage } : {}),
    };
  }

  let mutation: MutationResult | undefined;
  if (input.mutationCommand?.trim() && run.ok && !flaky) {
    const command = mutationCommandFor(input.mutationCommand, input.sourcePath, input.testPath);
    const mutationStarted = Date.now();
    const mutationRun = await runInSandbox({
      sandbox: input.sandbox,
      ...(input.repo ? { repo: input.repo } : {}),
      files: {
        [input.sourcePath]: input.source,
        [input.testPath]: input.test,
      },
      command,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    const report =
      mutationRun.artifacts["mutation.json"] ??
      mutationRun.artifacts["reports/mutation/mutation.json"] ??
      mutationRun.files["mutation.json"] ??
      mutationRun.files["reports/mutation/mutation.json"];
    mutation = report
      ? parseMutationReport(report, command, Date.now() - mutationStarted, {
          budgetStopped: mutationRun.timedOut === true,
        })
      : {
          status: "not-measured",
          tool: "stryker",
          command,
          reason: mutationRun.timedOut
            ? "The mutation run hit the time budget."
            : "The runner returned no mutation report.",
        };
    if (mutationRun.unreachable || mutationRun.environmentError) {
      mutation = {
        status: "not-measured",
        tool: "stryker",
        command,
        reason: mutationRun.output || "The runner could not execute the mutation command.",
      };
    }
  }

  return {
    ok: run.ok,
    verified: true,
    runs,
    output: [firstOutput, repeatNote].filter(Boolean).join("\n"),
    durationMs: Date.now() - started,
    ...(coverage ? { coverage } : {}),
    ...(mutation ? { mutation } : {}),
  };
}

/**
 * Formats a file with the repository's own formatter. The runner returns the
 * files it ended up with, so the formatted code is what goes into the pull
 * request.
 */
export async function formatWithRunner(input: {
  sandbox?: SandboxConfig;
  files: Record<string, string>;
  /** The formatter command, without the file name. */
  command: string;
  /** The file the formatter should write. */
  path: string;
  repo?: SandboxRepo;
  fetchImpl?: typeof fetch;
}): Promise<{ code?: string; output: string; ok: boolean }> {
  if (!input.sandbox?.url?.trim()) return { output: "", ok: true };
  const run = await runInSandbox({
    sandbox: input.sandbox,
    ...(input.repo ? { repo: input.repo } : {}),
    files: input.files,
    command: `${input.command} ${shellWord(input.path)}`,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
  const formatted = run.files[input.path];
  return {
    ...(typeof formatted === "string" ? { code: formatted } : {}),
    output: run.output,
    ok: run.ok,
  };
}

/** The output of a command that could not run at all. */
function couldNotRun(output: string): boolean {
  return /command not found|not recognized as an internal|Cannot find module|No such file or directory|executable file not found|is not installed|ENOENT/i.test(
    output,
  );
}

/** Runs the repository's own checks against the generated test. */
export async function runRepositoryChecks(input: {
  sandbox?: SandboxConfig;
  files: Record<string, string>;
  checks: { kind: CheckKind; name: string; command: string }[];
  repo?: SandboxRepo;
  fetchImpl?: typeof fetch;
}): Promise<CheckResult[]> {
  if (!input.sandbox?.url?.trim() || input.checks.length === 0) return [];
  const results: CheckResult[] = [];
  for (const check of input.checks) {
    const started = Date.now();
    const run = await runInSandbox({
      sandbox: input.sandbox,
      ...(input.repo ? { repo: input.repo } : {}),
      files: input.files,
      command: check.command,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    // A missing tool or a failed setup is not a failing check: the runner
    // cannot run it. Saying so is honest; pretending it passed would not be.
    const environmentError = run.environmentError;
    const skipped = !run.ok && (couldNotRun(run.output) || Boolean(environmentError));
    results.push({
      name: check.name,
      kind: check.kind,
      command: check.command,
      ok: run.ok,
      ...(skipped ? { skipped: true } : {}),
      ...(environmentError ? { environmentError } : {}),
      output: run.output || (run.ok ? `${check.name} passed.` : `${check.name} failed.`),
      durationMs: Date.now() - started,
    });
  }
  return results;
}
