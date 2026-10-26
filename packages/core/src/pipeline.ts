/**
 * The pipeline as an async generator: one implementation feeding both the SSE
 * route and (step by step) the durable Workflow.
 */
import type { AiBinding } from "./ai";
import { estimatePromptTokens, generateTest, type TokenUsage } from "./ai";
import type { AiConfig } from "./ai";
import type { GitHub } from "./github";
import { detectChecks, SUPPORT_FILES } from "./ci";
import {
  classifyTree,
  describeRepository,
  expectedTestPath,
  extractExports,
  parseOpenApiSpec,
  riskOf,
} from "./scanner";
import { generatedMarkerReason, testPathProblem } from "./policy";
import {
  formatWithRunner,
  runRepositoryChecks,
  staticCheck,
  validateTest,
  type SandboxConfig,
} from "./validate";
import { sandboxRepo, runInSandbox } from "./sandbox";
import { coverageTargetFor, type CoverageReport, type CoverageTarget } from "./coverage";
import { apiGaps, contractTestsFor, parseJUnit } from "./openapi";
import {
  HttpError,
  type ApiTestResult,
  type CheckResult,
  type RateLimitInfo,
  type Generation,
  type Gap,
  type OpenApiSpec,
  type RetestOperation,
  type RunEvent,
  type ScanResult,
  type ScanTotals,
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
  /** Per-file tasks in flight. Clamped 1–6, default 3. */
  concurrency?: number;
  /** `unit` generates unit tests, `api` contract tests, `both` does each. */
  mode?: "unit" | "api" | "both";
  /** When re-running after a failure, skip scan and regenerate only these paths. */
  retryGaps?: string[];
  /** Provider-reported tokens this run may spend; 0 or absent means no cap. */
  maxTokens?: number;
  /** When set, run only these failed operations and label the run a retest. */
  retestOperations?: RetestOperation[];
}

const DEFAULT_CONCURRENCY = 3;

/** Bounded work pool: `limit` workers pull from one index. No unbounded all. */
async function pool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await task(items[index] as T, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()),
  );
}

/** Runs a bounded async map, preserving input order. */
async function poolMap<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  await pool(items, limit, async (item, index) => {
    results[index] = await task(item, index);
  });
  return results;
}

/** A tiny async channel: tasks push, the generator drains, SSE stays live. */
function channel<T>() {
  const queue: T[] = [];
  let resolve: (() => void) | undefined;
  let closed = false;
  const wake = () => {
    resolve?.();
    resolve = undefined;
  };
  return {
    push(item: T) {
      queue.push(item);
      wake();
    },
    close() {
      closed = true;
      wake();
    },
    async *drain(): AsyncGenerator<T> {
      for (;;) {
        const item = queue.shift();
        if (item !== undefined) {
          yield item;
          continue;
        }
        if (closed) return;
        await new Promise<void>((next) => {
          resolve = next;
        });
      }
    },
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Jittered backoff for a provider that is rate limiting or unreachable. */
const backoff = (attempt: number): Promise<void> =>
  sleep(Math.min(4_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 250));

export interface PipelineOptions {
  github: GitHub;
  aiConfig: AiConfig;
  sandbox?: SandboxConfig;
  /** Sent to the sandbox only when `sandbox.allowRepoToken` is set. */
  repoToken?: string;
  ai?: AiBinding;
  fetchImpl?: typeof fetch;
}

const log = (level: "info" | "ai" | "warn" | "success" | "error", text: string): RunEvent => ({
  type: "log",
  level,
  text,
});

/** A single-quoted shell word, so a repository path cannot inject a command. */
const shellWord = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

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
  const repoArg = sandboxRepo({
    repo: input.repo,
    ref: input.ref,
    ...(options.sandbox ? { sandbox: options.sandbox } : {}),
    ...(options.repoToken ? { token: options.repoToken } : {}),
  });

  const retestOperations = input.retestOperations ?? [];
  const retest = retestOperations.length > 0;

  try {
    yield log("info", `EdgeSpec run started for ${input.repo}@${input.ref}.`);
    yield log("ai", `Model: ${model}.`);

    let loaded: Loaded[] = [];
    let blobs: string[] = [];
    let allGaps: Gap[] = [];
    let apiSpecs: OpenApiSpec[] = [];
    let apiGapList: Gap[] = [];
    let unsupported: Gap[] = [];
    const apiMode = input.mode === "api" || input.mode === "both";
    const unitMode = input.mode !== "api";
    const retry = Boolean(input.retryGaps && input.retryGaps.length > 0);

    if (retry) {
      // Re-run: skip the scan, regenerate only the paths that failed before.
      yield { type: "step", step: "scan", status: "done", note: "re-run" };
      yield log("info", `Re-running ${input.retryGaps?.length ?? 0} file(s) that did not pass.`);
      allGaps = (input.retryGaps ?? []).map((path) => ({
        path,
        // The retry paths are sources, so the test keeps the convention path;
        // reusing the source path would write a test over the source file.
        testPath: expectedTestPath(path),
        exports: [],
        reason: "",
        risk: "low" as const,
      }));
    } else {
      yield { type: "step", step: "scan", status: "start" };
      const tree = await github.tree(input.repo, input.ref);
      blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
      const classification = classifyTree(blobs);
      const gaps = unitMode ? classification.missing : [];
      unsupported = classification.unsupported;
      if (classification.skipped > 0) {
        yield log(
          "info",
          `${classification.skipped} file(s) skipped by policy (generated, vendored, migrations).`,
        );
      }

      if (apiMode) {
        const OPENAPI_LIKE = /(^|\/)(openapi|swagger|api[-_.]?spec)[^/]*\.(json|ya?ml)$/i;
        const specPaths = blobs.filter((path) => OPENAPI_LIKE.test(path)).slice(0, 4);
        apiSpecs = (
          await poolMap(specPaths, 4, async (path): Promise<OpenApiSpec | undefined> => {
            try {
              return parseOpenApiSpec(await github.file(input.repo, path, input.ref), path);
            } catch {
              return undefined;
            }
          })
        ).filter((spec): spec is OpenApiSpec => Boolean(spec));
        apiGapList = apiGaps(apiSpecs);
      }

      const totals: ScanTotals = {
        missing: gaps.length,
        coverage: 0,
        api: apiGapList.length,
        unsupported: unsupported.length,
        skipped: classification.skipped,
      };
      const overview = describeRepository(blobs);
      // A retest runs the named operations even when the scan finds no gap.
      if (!retest && gaps.length === 0 && apiGapList.length === 0) {
        yield {
          type: "gaps",
          gaps: unsupported,
          overview,
          totals,
          coverageStatus: "not-run",
        };
        yield { type: "step", step: "scan", status: "done", note: "No missing tests" };
        yield log("success", `No untested source files found in ${blobs.length} paths.`);
        yield {
          type: "result",
          ok: true,
          reason: "No missing tests found.",
          ...(retest ? { retest: true } : {}),
        };
        return;
      }

      allGaps = gaps;
      // The run covers as many gaps as the settings allow, highest risk first.
      // A gap whose test path is not a test artifact is refused, never written.
      const target: Gap[] = [];
      let refused = 0;
      for (const gap of gaps.slice(0, input.maxFiles)) {
        if (testPathProblem(gap.testPath)) refused += 1;
        else target.push(gap);
      }
      if (refused > 0) {
        yield log("warn", `Skipped ${refused} gap(s): only test paths may be generated.`);
      }
      // Source reads are independent; a bounded pool keeps a large scan honest.
      loaded = (await poolMap(target, 6, (gap) => load(github, input.repo, gap, input.ref))).filter(
        (file): file is Loaded => Boolean(file),
      );

      const scan: ScanResult = {
        repo: input.repo,
        ref: input.ref,
        scanned: blobs.length,
        gaps: gaps,
        coverageGaps: [],
        apiGaps: apiGapList,
        unsupported,
        totals,
        truncated: { missing: false, coverage: false, api: false },
        coverageStatus: "not-run",
        overview,
      };
      if (!retest) {
        yield {
          type: "gaps",
          gaps: [...gaps, ...apiGapList, ...unsupported],
          overview,
          totals,
          coverageStatus: scan.coverageStatus,
        };
      }
      yield {
        type: "step",
        step: "scan",
        status: "done",
        note: retest ? "retest specs" : `${gaps.length} missing`,
      };
      if (!retest) {
        yield log(
          "warn",
          `${gaps.length} missing, 0 coverage, ${apiGapList.length} API; this run covers ${loaded.length} missing file(s)${apiSpecs.length > 0 ? ` and ${apiSpecs.length} API spec(s)` : ""}.`,
        );
      }
    }

    if (retry) {
      // Load sources for the retry paths.
      loaded = [];
      for (const path of input.retryGaps ?? []) {
        const gap = allGaps.find((g) => g.path === path);
        if (!gap) continue;
        const problem = testPathProblem(gap.testPath);
        if (problem) {
          yield log("warn", `Skipped retry of ${path}: ${problem}.`);
          continue;
        }
        const file = await load(github, input.repo, gap, input.ref);
        if (file) loaded.push(file);
      }
    }

    // A file whose header says it is generated must not get a test, even when
    // its path looks ordinary. The scan cannot see contents; this can.
    if (loaded.length > 0) {
      const usable: Loaded[] = [];
      for (const file of loaded) {
        const marker = generatedMarkerReason(file.source);
        if (marker) {
          yield log("warn", `Skipped ${file.gap.path}: ${marker}.`);
          continue;
        }
        usable.push(file);
      }
      loaded = usable;
    }

    const blobsForChecks = input.retryGaps && input.retryGaps.length > 0 ? [] : blobs;
    const checks = await readRepositoryChecks(github, input.repo, input.ref, blobsForChecks);

    // Coverage is measured only when the visitor asked for it and a runner can
    // clone the repo. This first report is the baseline for every file's delta.
    const sandbox = options.sandbox;
    const testCheck = checks.checks.find((check) => check.kind === "test");
    const measureCoverage = Boolean(
      unitMode && loaded.length > 0 && sandbox?.coverage && repoArg && testCheck,
    );
    let baselineCoverage: CoverageReport | undefined;
    if (measureCoverage && sandbox && repoArg && testCheck) {
      yield log("info", `Measuring baseline coverage: ${testCheck.command}.`);
      const run = await runInSandbox({
        sandbox,
        repo: repoArg,
        command: testCheck.command,
        coverage: { format: "lcov" },
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
      baselineCoverage = run.coverage;
      yield log(
        baselineCoverage ? "info" : "warn",
        baselineCoverage
          ? "Baseline coverage measured."
          : `Baseline coverage not measured${run.output ? `: ${failureSummary(run.output, 300)}` : "."}`,
      );
    }

    // The baseline tells the prompt which lines and branches the suite missed.
    const coverageHints = new Map<string, CoverageTarget>();
    if (baselineCoverage) {
      for (const file of loaded) {
        const target = coverageTargetFor(baselineCoverage, file.gap.path);
        if (target) coverageHints.set(file.gap.path, target);
      }
      if (coverageHints.size > 0) {
        yield log(
          "info",
          `Coverage targeting: ${coverageHints.size} file(s) with uncovered lines or branches.`,
        );
      }
    }

    // The budget is provider-reported tokens. With no cap, the run still shows
    // an estimate so the reader knows the order of magnitude before spending.
    const cap = Math.max(0, Math.round(input.maxTokens ?? 0));
    let spentTokens = 0;
    let usageSeen = false;
    let budgetStopped = false;
    if (loaded.length > 0) {
      let low = 0;
      let high = 0;
      for (const file of loaded) {
        const hint = coverageHints.get(file.gap.path);
        const estimate = estimatePromptTokens({
          filePath: file.gap.path,
          source: file.source,
          config: aiConfig,
          coverageTarget: input.coverageTarget,
          ...(hint ? { coverageHint: hint } : {}),
          ...(checks.style.length ? { style: checks.style } : {}),
          ...(checks.checks.length
            ? {
                checks: checks.checks.map((check) => ({
                  name: check.name,
                  command: check.command,
                })),
              }
            : {}),
        });
        low += estimate.low;
        high += estimate.high;
      }
      yield log(
        "info",
        `Estimated input tokens: ${low}–${high} for ${loaded.length} file(s)${cap > 0 ? ` · budget ${cap}` : " · no budget cap"}.`,
      );
    }

    const ready = new Set<string>();
    // A sandbox may cap its own runs; honour the tighter of the two.
    const effective = Math.min(
      6,
      Math.max(1, Math.round(input.concurrency ?? DEFAULT_CONCURRENCY)),
      options.sandbox?.concurrency ?? 6,
    );

    if (unitMode && loaded.length > 0) {
      const events = channel<RunEvent>();
      const emit = (event: RunEvent) => events.push(event);

      const runFile = async (file: Loaded, index: number): Promise<boolean> => {
        const { gap, source } = file;
        const position = `${index + 1}/${loaded.length}`;
        const coverageHint = coverageHints.get(gap.path);

        if (cap > 0 && spentTokens >= cap) {
          if (!budgetStopped) {
            budgetStopped = true;
            emit(
              log("warn", `Token budget reached (${spentTokens}/${cap}); no new files will start.`),
            );
          }
          return false;
        }

        emit({
          type: "step",
          step: "generate",
          status: "start",
          note: position,
          sourcePath: gap.path,
        });
        emit(log("info", `Fetching ${gap.path}...`));
        emit(log("ai", `Generating ${gap.testPath}...`));

        let rateLimit: RateLimitInfo | undefined;
        const generateInput = {
          filePath: gap.path,
          source,
          config: aiConfig,
          coverageTarget: input.coverageTarget,
          ...(coverageHint ? { coverageHint } : {}),
          onUsage: (usage: TokenUsage) => {
            usageSeen = true;
            spentTokens += usage.input + usage.output;
            if (cap > 0 && spentTokens >= cap && !budgetStopped) {
              budgetStopped = true;
              emit(
                log(
                  "warn",
                  `Token budget reached (${spentTokens}/${cap}); finishing the current file.`,
                ),
              );
            }
          },
          onNotice: (text: string) => emit(log("warn", text)),
          onRateLimit: (info: RateLimitInfo) => {
            rateLimit = info;
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
        let code: string | undefined;
        let generateError: unknown;
        // Retry the AI call when the provider is unreachable or errors out, up
        // to the configured number of retries, so a transient failure does not
        // kill the whole run for a single file.
        for (let attempt = 0; attempt <= input.maxAiRetries; attempt += 1) {
          try {
            code = await generateTest(generateInput as Parameters<typeof generateTest>[0]);
            break;
          } catch (error) {
            generateError = error;
            if (attempt < input.maxAiRetries) {
              emit(
                log(
                  "warn",
                  `AI call failed for ${gap.path} (${attempt + 1}/${input.maxAiRetries + 1}), retrying…`,
                ),
              );
              await backoff(attempt);
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
            ...(repoArg ? { repo: repoArg } : {}),
            files: { ...checks.support, [gap.path]: source, [gap.testPath]: code },
            command: checks.formatter.command,
            path: gap.testPath,
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          });
          if (formatted.code && formatted.code.trim()) code = formatted.code;
        }

        if (rateLimit) emit({ type: "quota", rateLimit });

        let generation: Generation = {
          sourcePath: gap.path,
          testPath: gap.testPath,
          code,
          provider: aiConfig.provider.id,
          model: aiConfig.model,
          corrected: false,
          source,
        };
        emit({ type: "generation", generation });
        emit({
          type: "step",
          step: "generate",
          status: "done",
          note: `${position} · ${code.split("\n").length} lines`,
          sourcePath: gap.path,
        });

        let attempt = 0;
        emit({
          type: "step",
          step: "validate",
          status: "start",
          note: position,
          sourcePath: gap.path,
        });
        let validation = await validateTest({
          sourcePath: gap.path,
          source,
          testPath: gap.testPath,
          test: code,
          strictTypes: input.strictTypes,
          ...(options.sandbox ? { sandbox: options.sandbox } : {}),
          ...(repoArg ? { repo: repoArg } : {}),
          ...(measureCoverage ? { measureCoverage: true } : {}),
          ...(baselineCoverage ? { baselineCoverage } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });

        // The repository's own CI commands, run against the generated test.
        const checkResults = await runRepositoryChecks({
          sandbox: options.sandbox,
          ...(repoArg ? { repo: repoArg } : {}),
          files: { ...checks.support, [gap.path]: source, [gap.testPath]: code },
          checks: checks.checks,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        validation = withChecks(validation, checkResults);

        emit({ type: "validation", validation, sourcePath: gap.path });
        emit({
          type: "step",
          step: "validate",
          status: validation.ok ? "done" : "failed",
          note: validation.verified
            ? `${position} · ${
                checkResults.length > 0
                  ? `${checkResults.filter((check) => check.ok).length}/${checkResults.length} checks`
                  : "bun test"
              }`
            : `${position} · static check only`,
          sourcePath: gap.path,
        });
        emit(
          log(
            validation.ok ? "success" : "warn",
            validation.verified
              ? validation.ok
                ? `bun test passed in ${validation.durationMs} ms.`
                : `bun test failed in ${validation.durationMs} ms.`
              : (validation.output.split("\n")[0] ?? "Static validation complete."),
          ),
        );
        for (const check of checkResults) {
          emit(
            log(
              check.ok ? "success" : "warn",
              `${check.name} (${check.command}): ${check.ok ? "passed" : "failed"}`,
            ),
          );
        }
        if (!validation.ok) {
          emit(log("error", `${gap.path} validation failed: ${failureSummary(validation.output)}`));
        }

        while (!validation.ok && attempt < input.maxRetries && !(cap > 0 && spentTokens >= cap)) {
          attempt += 1;
          emit({
            type: "step",
            step: "correct",
            status: "start",
            note: `${position} · ${attempt}`,
            sourcePath: gap.path,
          });
          emit(log("ai", `Self-correction ${attempt}/${input.maxRetries}...`));

          let retryRateLimit: RateLimitInfo | undefined;
          const retryGenerateInput = {
            filePath: gap.path,
            source,
            config: aiConfig,
            previous: { code, output: validation.output },
            coverageTarget: input.coverageTarget,
            ...(coverageHint ? { coverageHint } : {}),
            onUsage: (usage: TokenUsage) => {
              usageSeen = true;
              spentTokens += usage.input + usage.output;
              if (cap > 0 && spentTokens >= cap && !budgetStopped) {
                budgetStopped = true;
                emit(
                  log(
                    "warn",
                    `Token budget reached (${spentTokens}/${cap}); finishing the current file.`,
                  ),
                );
              }
            },
            onNotice: (text: string) => emit(log("warn", text)),
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
          for (let retry = 0; retry <= input.maxAiRetries; retry += 1) {
            try {
              retryCode = await generateTest(
                retryGenerateInput as Parameters<typeof generateTest>[0],
              );
              break;
            } catch (error) {
              retryGenerateError = error;
              if (retry < input.maxAiRetries) {
                emit(
                  log(
                    "warn",
                    `AI call failed for ${gap.path} correction ${attempt} (${retry + 1}/${input.maxAiRetries + 1}), retrying…`,
                  ),
                );
                await backoff(retry);
                continue;
              }
            }
          }
          if (retryCode === undefined) throw retryGenerateError;
          code = retryCode;
          generation = { ...generation, code, corrected: true };
          emit({ type: "generation", generation });
          if (retryRateLimit) emit({ type: "quota", rateLimit: retryRateLimit });

          validation = await validateTest({
            sourcePath: gap.path,
            source,
            testPath: gap.testPath,
            test: code,
            strictTypes: input.strictTypes,
            ...(options.sandbox ? { sandbox: options.sandbox } : {}),
            ...(repoArg ? { repo: repoArg } : {}),
            ...(measureCoverage ? { measureCoverage: true } : {}),
            ...(baselineCoverage ? { baselineCoverage } : {}),
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          });
          const retryChecks = await runRepositoryChecks({
            sandbox: options.sandbox,
            ...(repoArg ? { repo: repoArg } : {}),
            files: { ...checks.support, [gap.path]: source, [gap.testPath]: code },
            checks: checks.checks,
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          });
          validation = withChecks(validation, retryChecks);
          emit({ type: "validation", validation, sourcePath: gap.path });
          emit({
            type: "step",
            step: "correct",
            status: validation.ok ? "done" : "failed",
            note: `${position} · ${attempt}`,
            sourcePath: gap.path,
          });
          emit(
            log(
              validation.ok ? "success" : "warn",
              validation.ok
                ? `Correction passed (${validation.durationMs} ms).`
                : `Correction ${attempt} still failing.`,
            ),
          );
          if (!validation.ok) {
            emit(
              log(
                "error",
                `${gap.path} correction ${attempt} failed: ${failureSummary(validation.output)}`,
              ),
            );
          }
        }

        if (!validation.ok) {
          emit(log("error", `${gap.path}: validation did not pass, so it waits for a review.`));
          return false;
        }
        return true;
      };

      const producer = (async () => {
        try {
          await pool(loaded, effective, async (file, index) => {
            try {
              if (await runFile(file, index)) ready.add(file.gap.path);
            } catch (error) {
              // One file that exhausts its retries fails alone; the run goes on.
              const message = error instanceof Error ? error.message : String(error);
              emit(log("error", `${file.gap.path}: ${message}`));
              emit(
                log(
                  "error",
                  `${file.gap.path}: generation did not finish, so it waits for a review.`,
                ),
              );
            }
          });
        } finally {
          events.close();
        }
      })();
      for await (const event of events.drain()) yield event;
      await producer;
    }

    if (apiMode && apiSpecs.length > 0) {
      if (retest) {
        yield log(
          "info",
          `Retest: only ${retestOperations.length} failed endpoint(s), not a fresh scan.`,
        );
      }
      for (const [index, spec] of apiSpecs.entries()) {
        const contract = contractTestsFor(
          spec,
          retest
            ? (operation) =>
                retestOperations.some(
                  (item) =>
                    item.specPath === spec.path &&
                    item.method.toUpperCase() === operation.method.toUpperCase() &&
                    item.path === operation.path,
                )
            : undefined,
        );
        // A retest runs no operation from a spec that had no failures.
        if (contract.operations.length === 0) continue;
        const position = `${index + 1}/${apiSpecs.length}`;

        yield {
          type: "step",
          step: "generate",
          status: "start",
          note: `api ${position}`,
          sourcePath: spec.path,
        };
        const generation: Generation = {
          sourcePath: spec.path,
          testPath: contract.path,
          code: contract.code,
          provider: "openapi",
          model: "deterministic",
          corrected: false,
        };
        yield { type: "generation", generation };
        yield {
          type: "step",
          step: "generate",
          status: "done",
          note: `api ${position} · ${contract.operations.length} operation(s)`,
          sourcePath: spec.path,
        };

        let results: ApiTestResult[] = contract.operations.map((operation) => {
          const skipped = contract.skipped.find(
            (item) => item.method === operation.method && item.path === operation.path,
          );
          return {
            specPath: spec.path,
            method: operation.method,
            path: operation.path,
            status: skipped ? "skipped" : "not-run",
            ...(skipped ? { error: skipped.reason } : {}),
          };
        });

        let validation: Validation;
        const problems = staticCheck(contract.code, input.strictTypes);
        if (problems.length > 0) {
          validation = {
            ok: false,
            verified: false,
            output: problems.map((problem) => `- ${problem.problem}`).join("\n"),
            durationMs: 0,
          };
        } else if (!options.sandbox?.url?.trim()) {
          validation = {
            ok: true,
            verified: false,
            output:
              "Static checks passed. No sandbox runner is configured, so the contract tests were not executed.",
            durationMs: 0,
          };
        } else {
          const started = Date.now();
          const sandbox: SandboxConfig = { ...options.sandbox };
          const readyUrl = options.sandbox.server?.readyUrl;
          if (readyUrl) {
            try {
              const base = new URL(readyUrl).origin;
              sandbox.env = { ...options.sandbox.env, BASE_URL: base };
            } catch {
              // A malformed ready URL is the runner's problem, not ours.
            }
          }
          const run = await runInSandbox({
            sandbox,
            ...(repoArg ? { repo: repoArg } : {}),
            files: {
              [spec.path]: spec.content ?? "",
              [contract.path]: contract.code,
            },
            command: `bun test ${shellWord(contract.path)} --reporter=junit --reporter-outfile=junit.xml`,
            coverage: { format: "lcov" },
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          });
          if (run.unreachable || run.environmentError) {
            // No app, no test result. Never turn a boot failure into green.
            results = results.map((result) => ({ ...result, status: "not-run" as const }));
            validation = {
              ok: false,
              verified: false,
              output: run.output,
              durationMs: Date.now() - started,
              ...(run.environmentError ? { environmentError: run.environmentError } : {}),
            };
          } else {
            const parsed = parseJUnit(run.artifacts["junit.xml"] ?? "", spec.path);
            if (parsed.length > 0) results = parsed;
            validation = {
              ok: run.ok,
              verified: true,
              output: run.output || (run.ok ? "Contract tests passed." : "Contract tests failed."),
              durationMs: Date.now() - started,
            };
          }
        }

        yield { type: "api", results, ...(retest ? { retest: true } : {}) };
        yield { type: "validation", validation, sourcePath: spec.path };
        const passed = results.filter((result) => result.status === "passed").length;
        yield {
          type: "step",
          step: "validate",
          status: validation.ok ? "done" : "failed",
          note: `api ${position} · ${passed}/${results.length}`,
          sourcePath: spec.path,
        };
        for (const result of results) {
          yield log(
            result.status === "passed" ? "success" : result.status === "failed" ? "warn" : "info",
            `${result.method} ${result.path}: ${result.status}${result.error ? ` · ${result.error}` : ""}`,
          );
        }
        if (validation.ok) ready.add(spec.path);
      }
    }

    // Scan order, not completion order: two files that finish at the same time
    // still produce the same `ready` list.
    const ordered = [
      ...loaded.map((file) => file.gap.path).filter((path) => ready.has(path)),
      ...(apiMode ? apiSpecs.map((spec) => spec.path).filter((path) => ready.has(path)) : []),
    ];

    if (cap > 0 && !usageSeen && loaded.length > 0) {
      yield log(
        "warn",
        "The provider did not report token usage; the token budget could not be enforced.",
      );
    }

    if (budgetStopped) {
      yield { type: "step", step: "pull-request", status: "failed", note: "Budget" };
      yield log(
        "warn",
        `Token budget reached after ${spentTokens} reported tokens. ${ordered.length} test(s) from the partial run are ready.`,
      );
      yield {
        type: "result",
        ok: false,
        reason: `Token budget reached (${spentTokens}/${cap} tokens).`,
        ready: ordered,
        ...(retest ? { retest: true } : {}),
      };
      return;
    }

    if (ordered.length === 0) {
      yield { type: "step", step: "pull-request", status: "failed", note: "No PR" };
      yield log("error", "No test passed the check. Open Missing tests to look at them.");
      yield {
        type: "result",
        ok: false,
        reason: "Validation did not pass.",
        ready: ordered,
        ...(retest ? { retest: true } : {}),
      };
      return;
    }

    // A run never opens a pull request: every test waits in Ready tests,
    // where the preview and the Open PR button live.
    yield {
      type: "step",
      step: "pull-request",
      status: "done",
      note: `${ordered.length} ready to open`,
    };
    yield log(
      "success",
      `${ordered.length} test(s) ready. Review the preview, then open the pull request.`,
    );
    yield {
      type: "result",
      ok: true,
      ready: ordered,
      ...(retest ? { retest: true } : {}),
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
    yield { type: "result", ok: false, reason: message, ...(retest ? { retest: true } : {}) };
  }
}
