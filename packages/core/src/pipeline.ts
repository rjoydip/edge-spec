/**
 * The pipeline as an async generator: one implementation feeding both the SSE
 * route and (step by step) the durable Workflow.
 */
import type { AiBinding } from "./ai";
import { generateTest } from "./ai";
import type { AiConfig } from "./ai";
import type { GitHub } from "./github";
import { detectChecks, SUPPORT_FILES } from "./ci";
import { describeRepository, extractExports, findGaps, riskOf } from "./scanner";
import {
  formatWithRunner,
  runRepositoryChecks,
  validateTest,
  type SandboxConfig,
} from "./validate";
import {
  HttpError,
  type CheckResult,
  type RateLimitInfo,
  type Generation,
  type Gap,
  type RunEvent,
  type ScanResult,
  type Validation,
} from "./types";

export interface PipelineInput {
  repo: string;
  ref: string;
  maxRetries: number;
  maxAiRetries: number;
  strictTypes: boolean;
  coverageTarget: number;
  /** How many gap files one run covers. */
  maxFiles: number;
  /** When re-running after a failure, skip scan and regenerate only these paths. */
  retryGaps?: string[];
}

export interface PipelineOptions {
  github: GitHub;
  aiConfig: AiConfig;
  sandbox?: SandboxConfig;
  ai?: AiBinding;
  fetchImpl?: typeof fetch;
}

const log = (level: "info" | "ai" | "warn" | "success" | "error", text: string): RunEvent => ({
  type: "log",
  level,
  text,
});

/** One line of a failure, so the log shows the reason instead of just "failed". */
function failureSummary(output: string, max = 1200): string {
  const text = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" · ");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The source of a file and the gap facts read from it. */
interface Loaded {
  gap: Gap;
  source: string;
}

/** Fills in exported symbols; failure is cosmetic, so it never aborts a scan. */
async function load(github: GitHub, repo: string, gap: Gap, ref: string): Promise<Loaded | null> {
  try {
    const source = await github.file(repo, gap.path, ref);
    const exports = extractExports(source);
    return { source, gap: { ...gap, exports, risk: riskOf(gap.path, exports.length) } };
  } catch {
    return null;
  }
}

/** Merges the repository check results into the validation. */
export function withChecks(validation: Validation, checks: CheckResult[]): Validation {
  if (checks.length === 0) return validation;
  const failed = checks.filter((check) => !check.ok && !check.skipped);
  const output = [
    validation.output,
    ...failed.map(
      (check) => `Check ${check.name} (${check.command}) failed:\n${check.output.slice(0, 2000)}`,
    ),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
  return {
    ...validation,
    ok: validation.ok && failed.length === 0,
    checks,
    output,
  };
}

/**
 * The rules of the repository: the formatter, the CI commands, the style and
 * the small files a check needs (the manifest and the config files).
 */
interface RepositoryRules {
  checks: {
    kind: "format" | "lint" | "typecheck" | "build" | "test";
    name: string;
    command: string;
  }[];
  formatter?: { name: string; command: string };
  style: string[];
  support: Record<string, string>;
}

export async function readRepositoryChecks(
  github: GitHub,
  repo: string,
  ref: string,
  paths: readonly string[],
): Promise<RepositoryRules> {
  const names = new Set(paths.map((path) => path.slice(path.lastIndexOf("/") + 1)));
  const wanted: string[] = [];
  for (const file of SUPPORT_FILES) {
    if (names.has(file) && paths.includes(file)) wanted.push(file);
  }
  const workflows = paths
    .filter((path) => path.startsWith(".github/workflows/") && path.endsWith(".yml"))
    .slice(0, 4);
  wanted.push(...workflows);

  const support: Record<string, string> = {};
  const workflowFiles: Record<string, string> = {};
  for (const path of wanted) {
    try {
      const content = await github.file(repo, path, ref);
      if (path.startsWith(".github/workflows/")) workflowFiles[path] = content;
      else support[path] = content;
    } catch {
      // A file we cannot read is a rule we cannot apply.
    }
  }

  const detected = detectChecks({
    paths,
    ...(support["package.json"] ? { packageJson: support["package.json"] } : {}),
    workflows: workflowFiles,
    files: support,
  });

  return {
    checks: detected.checks,
    ...(detected.formatter ? { formatter: detected.formatter } : {}),
    style: detected.style,
    support,
  };
}

export async function* runPipeline(
  input: PipelineInput,
  options: PipelineOptions,
): AsyncGenerator<RunEvent> {
  const { github, aiConfig } = options;
  const model = `${aiConfig.provider.name} · ${aiConfig.model}`;

  try {
    yield log("info", `EdgeSpec run started for ${input.repo}@${input.ref}.`);
    yield log("ai", `Model: ${model}.`);

    let loaded: Loaded[] = [];
    let blobs: string[] = [];
    let allGaps: Gap[] = [];

    if (input.retryGaps && input.retryGaps.length > 0) {
      // Re-run: skip the scan, regenerate only the paths that failed before.
      yield { type: "step", step: "scan", status: "done", note: "re-run" };
      yield log("info", `Re-running ${input.retryGaps.length} file(s) that did not pass.`);
      allGaps = input.retryGaps.map((path) => ({
        path,
        testPath: path,
        exports: [],
        reason: "",
        risk: "low" as const,
      }));
    } else {
      yield { type: "step", step: "scan", status: "start" };
      const tree = await github.tree(input.repo, input.ref);
      blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
      const gaps = findGaps(blobs);
      if (gaps.length === 0) {
        yield { type: "step", step: "scan", status: "done", note: "No missing tests" };
        yield log("success", `No untested source files found in ${blobs.length} paths.`);
        yield { type: "result", ok: true, reason: "No missing tests found." };
        return;
      }

      allGaps = gaps;
      // The run covers as many gaps as the settings allow, highest risk first.
      const target = gaps.slice(0, input.maxFiles);
      loaded = [];
      for (const gap of target) {
        const file = await load(github, input.repo, gap, input.ref);
        if (file) loaded.push(file);
      }

      const scan: ScanResult = {
        repo: input.repo,
        ref: input.ref,
        scanned: blobs.length,
        gaps: [...loaded.map((item) => item.gap), ...gaps.slice(input.maxFiles)],
        overview: describeRepository(blobs),
      };
      yield { type: "gaps", gaps: scan.gaps, overview: scan.overview };
      yield { type: "step", step: "scan", status: "done", note: `${gaps.length} gaps` };
      yield log(
        "warn",
        `${gaps.length} untested file(s) found. This run covers ${loaded.length} of them.`,
      );
    }

    if (input.retryGaps && input.retryGaps.length > 0) {
      // Load sources for the retry paths.
      loaded = [];
      for (const path of input.retryGaps) {
        const gap = allGaps.find((g) => g.path === path);
        if (!gap) continue;
        const file = await load(github, input.repo, gap, input.ref);
        if (file) loaded.push(file);
      }
    }

    const blobsForChecks = input.retryGaps && input.retryGaps.length > 0 ? [] : blobs;
    const checks = await readRepositoryChecks(github, input.repo, input.ref, blobsForChecks);

    const ready: string[] = [];
    let last: { generation: Generation; validation: Validation } | undefined;

    for (const [index, file] of loaded.entries()) {
      const { gap, source } = file;
      const position = `${index + 1}/${loaded.length}`;

      yield { type: "step", step: "generate", status: "start", note: position };
      yield log("info", `Fetching ${gap.path}...`);
      yield log("ai", `Generating ${gap.testPath}...`);

      let rateLimit: RateLimitInfo | undefined;
      const generateInput = {
        filePath: gap.path,
        source,
        config: aiConfig,
        coverageTarget: input.coverageTarget,
        onRateLimit: (info: RateLimitInfo) => {
          rateLimit = info;
        },
        ...(checks.style.length ? { style: checks.style } : {}),
        ...(checks.checks.length
          ? { checks: checks.checks.map((check) => ({ name: check.name, command: check.command })) }
          : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      };
      let code: string | undefined;
      let generateError: unknown;
      // Retry the AI call when the provider is unreachable or errors out, up to
      // the configured number of retries, so a transient failure does not kill
      // a whole run for a single file.
      for (let attempt = 0; attempt <= input.maxAiRetries; attempt += 1) {
        try {
          code = await generateTest(generateInput as Parameters<typeof generateTest>[0]);
          break;
        } catch (error) {
          generateError = error;
          if (attempt < input.maxAiRetries) {
            yield log(
              "warn",
              `AI call failed for ${gap.path} (${attempt + 1}/${input.maxAiRetries + 1}), retrying…`,
            );
            continue;
          }
        }
      }
      if (code === undefined) throw generateError;

      // The repository formats the file itself, so the code in the pull
      // request is the code CI will see.
      if (checks.formatter && options.sandbox) {
        const formatted = await formatWithRunner({
          sandbox: options.sandbox,
          files: { ...checks.support, [gap.path]: source, [gap.testPath]: code },
          command: checks.formatter.command,
          path: gap.testPath,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        if (formatted.code && formatted.code.trim()) code = formatted.code;
      }

      if (rateLimit) yield { type: "quota", rateLimit };

      let generation: Generation = {
        sourcePath: gap.path,
        testPath: gap.testPath,
        code,
        provider: aiConfig.provider.id,
        model: aiConfig.model,
        corrected: false,
        source,
      };
      yield { type: "generation", generation };
      yield {
        type: "step",
        step: "generate",
        status: "done",
        note: `${position} · ${code.split("\n").length} lines`,
      };

      let attempt = 0;
      yield { type: "step", step: "validate", status: "start", note: position };
      let validation = await validateTest({
        sourcePath: gap.path,
        source,
        testPath: gap.testPath,
        test: code,
        strictTypes: input.strictTypes,
        ...(options.sandbox ? { sandbox: options.sandbox } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });

      // The repository's own CI commands, run against the generated test.
      const checkResults = await runRepositoryChecks({
        sandbox: options.sandbox,
        files: { ...checks.support, [gap.path]: source, [gap.testPath]: code },
        checks: checks.checks,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
      validation = withChecks(validation, checkResults);

      yield { type: "validation", validation };
      yield {
        type: "step",
        step: "validate",
        status: validation.ok ? "done" : "failed",
        note: validation.verified
          ? `${position} · ${checkResults.length > 0 ? `${checkResults.filter((check) => check.ok).length}/${checkResults.length} checks` : "bun test"}`
          : `${position} · static check only`,
      };
      yield log(
        validation.ok ? "success" : "warn",
        validation.verified
          ? validation.ok
            ? `bun test passed in ${validation.durationMs} ms.`
            : `bun test failed in ${validation.durationMs} ms.`
          : (validation.output.split("\n")[0] ?? "Static validation complete."),
      );
      for (const check of checkResults) {
        yield log(
          check.ok ? "success" : "warn",
          `${check.name} (${check.command}): ${check.ok ? "passed" : "failed"}`,
        );
      }
      if (!validation.ok) {
        yield log("error", `${gap.path} validation failed: ${failureSummary(validation.output)}`);
      }

      while (!validation.ok && attempt < input.maxRetries) {
        attempt += 1;
        yield { type: "step", step: "correct", status: "start", note: `${position} · ${attempt}` };
        yield log("ai", `Self-correction ${attempt}/${input.maxRetries}...`);

        let retryRateLimit: RateLimitInfo | undefined;
        const retryGenerateInput = {
          filePath: gap.path,
          source,
          config: aiConfig,
          previous: { code, output: validation.output },
          coverageTarget: input.coverageTarget,
          onRateLimit: (info: RateLimitInfo) => {
            retryRateLimit = info;
          },
          ...(checks.style.length ? { style: checks.style } : {}),
          ...(checks.checks.length
            ? {
                checks: checks.checks.map((check) => ({
                  name: check.name,
                  command: check.command,
                })),
              }
            : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        };
        let retryCode: string | undefined;
        let retryGenerateError: unknown;
        for (let attempt = 0; attempt <= input.maxAiRetries; attempt += 1) {
          try {
            retryCode = await generateTest(
              retryGenerateInput as Parameters<typeof generateTest>[0],
            );
            break;
          } catch (error) {
            retryGenerateError = error;
            if (attempt < input.maxAiRetries) {
              yield log(
                "warn",
                `AI call failed for ${gap.path} correction ${attempt} (${attempt + 1}/${input.maxAiRetries + 1}), retrying…`,
              );
              continue;
            }
          }
        }
        if (retryCode === undefined) throw retryGenerateError;
        code = retryCode;
        generation = { ...generation, code, corrected: true };
        yield { type: "generation", generation };
        if (retryRateLimit) yield { type: "quota", rateLimit: retryRateLimit };

        validation = await validateTest({
          sourcePath: gap.path,
          source,
          testPath: gap.testPath,
          test: code,
          strictTypes: input.strictTypes,
          ...(options.sandbox ? { sandbox: options.sandbox } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        const retryChecks = await runRepositoryChecks({
          sandbox: options.sandbox,
          files: { ...checks.support, [gap.path]: source, [gap.testPath]: code },
          checks: checks.checks,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        validation = withChecks(validation, retryChecks);
        yield { type: "validation", validation };
        yield {
          type: "step",
          step: "correct",
          status: validation.ok ? "done" : "failed",
          note: `${position} · ${attempt}`,
        };
        yield log(
          validation.ok ? "success" : "warn",
          validation.ok
            ? `Correction passed (${validation.durationMs} ms).`
            : `Correction ${attempt} still failing.`,
        );
        if (!validation.ok) {
          yield log(
            "error",
            `${gap.path} correction ${attempt} failed: ${failureSummary(validation.output)}`,
          );
        }
      }

      if (!validation.ok) {
        yield log("error", `${gap.path}: validation did not pass, so it waits for a review.`);
        continue;
      }
      ready.push(gap.path);
      last = { generation, validation };
    }

    if (ready.length === 0) {
      yield { type: "step", step: "pull-request", status: "failed", note: "No PR" };
      yield log("error", "No test passed the check. Open Missing tests to look at them.");
      yield { type: "result", ok: false, reason: "Validation did not pass.", ready };
      return;
    }

    // A run never opens a pull request: every test waits in Ready tests,
    // where the preview and the Open PR button live.
    yield {
      type: "step",
      step: "pull-request",
      status: "done",
      note: `${ready.length} ready to open`,
    };
    yield log(
      "success",
      `${ready.length} test(s) ready. Review the preview, then open the pull request.`,
    );
    yield {
      type: "result",
      ok: true,
      ...(last ? { generation: last.generation } : {}),
      ready,
    };
  } catch (error) {
    const message =
      error instanceof HttpError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    yield log("error", message);
    yield { type: "error", message };
    yield { type: "result", ok: false, reason: message };
  }
}
