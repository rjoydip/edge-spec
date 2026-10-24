/**
 * Validation. A real runner is optional: without one, EdgeSpec says so instead
 * of claiming a test passed.
 */
import type { CheckKind, CheckResult, Validation } from "./types";

export interface SandboxConfig {
  url?: string;
  apiKey?: string;
}

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

interface SandboxReply {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  /** The files after the command ran, when the runner returns them. */
  files?: Record<string, string>;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

export interface ValidateInput {
  sourcePath: string;
  source: string;
  testPath: string;
  test: string;
  strictTypes: boolean;
  sandbox?: SandboxConfig;
  fetchImpl?: typeof fetch;
}

export interface SandboxRun {
  ok: boolean;
  exitCode: number;
  output: string;
  /** The files the runner returned after the command. */
  files: Record<string, string>;
  /** Set when the runner could not be reached. */
  unreachable?: string;
}

/**
 * Runs one command in the sandbox with the given files. The runner may return
 * the files it ended up with, which is how a formatter returns formatted code.
 */
export async function runInSandbox(input: {
  sandbox?: SandboxConfig;
  files: Record<string, string>;
  command: string;
  fetchImpl?: typeof fetch;
}): Promise<SandboxRun> {
  const url = input.sandbox?.url?.trim();
  if (!url) {
    return { ok: false, exitCode: 1, output: "No sandbox runner is configured.", files: {} };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.sandbox?.apiKey) headers.authorization = `Bearer ${input.sandbox.apiKey}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ files: input.files, command: input.command }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      exitCode: 1,
      output: `Sandbox unreachable: ${message}`,
      files: {},
      unreachable: message,
    };
  }

  const text = await response.text();
  let reply: SandboxReply = {};
  try {
    reply = asRecord(JSON.parse(text)) as SandboxReply;
  } catch {
    // Treated as a runner failure below.
  }

  if (!response.ok) {
    return {
      ok: false,
      exitCode: 1,
      output: `Sandbox returned ${response.status}: ${text.slice(0, 2000)}`,
      files: {},
    };
  }

  const exitCode = Number(reply.exitCode ?? 1);
  const output = [reply.stdout, reply.stderr].filter(Boolean).join("\n").slice(0, 6000);
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(reply.files ?? {})) {
    if (typeof content === "string") files[path] = content;
  }
  return { ok: exitCode === 0, exitCode, output, files };
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
    files: {
      [input.sourcePath]: input.source,
      [input.testPath]: input.test,
    },
    command: "bun test",
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });

  if (run.unreachable) {
    return {
      ok: false,
      verified: false,
      output: run.output,
      durationMs: Date.now() - started,
    };
  }

  return {
    ok: run.ok,
    verified: true,
    output: run.output || (run.ok ? "bun test passed." : "bun test failed without output."),
    durationMs: Date.now() - started,
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
  fetchImpl?: typeof fetch;
}): Promise<{ code?: string; output: string; ok: boolean }> {
  if (!input.sandbox?.url?.trim()) return { output: "", ok: true };
  const run = await runInSandbox({
    sandbox: input.sandbox,
    files: input.files,
    command: `${input.command} ${input.path}`,
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
  fetchImpl?: typeof fetch;
}): Promise<CheckResult[]> {
  if (!input.sandbox?.url?.trim() || input.checks.length === 0) return [];
  const results: CheckResult[] = [];
  for (const check of input.checks) {
    const started = Date.now();
    const run = await runInSandbox({
      sandbox: input.sandbox,
      files: input.files,
      command: check.command,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    // A missing tool is not a failing check: the runner cannot run it. Saying
    // so is honest; pretending it passed would not be.
    const skipped = !run.ok && couldNotRun(run.output);
    results.push({
      name: check.name,
      kind: check.kind,
      command: check.command,
      ok: run.ok,
      ...(skipped ? { skipped: true } : {}),
      output: run.output || (run.ok ? `${check.name} passed.` : `${check.name} failed.`),
      durationMs: Date.now() - started,
    });
  }
  return results;
}
