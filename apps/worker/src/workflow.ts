/**
 * The durable path for GitHub webhooks: it scans a repository, writes the
 * missing test, checks it and opens the pull request. It runs with
 * deployment-owned credentials (Workers AI + GITHUB_TOKEN) because Workflow
 * params are persisted; a visitor's API key must never end up in that state.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { PROMPT_VERSION, generateTest } from "@edge-spec/core/ai";
import { DEFAULT_AI, pipelineConfig, providerById } from "@edge-spec/core/catalog";
import { detectPackageManager, detectRunner } from "@edge-spec/core/ci";
import { GitHub } from "@edge-spec/core/github";
import { InstallationTokenCache, gitHubAppFromEnv } from "@edge-spec/core/github-app";
import { coverageForFile } from "@edge-spec/core/coverage";
import { contractPathFor } from "@edge-spec/core/openapi";
import { buildPrCheck, type PrCheckResult } from "@edge-spec/core/pr-check";
import { impactForChanges } from "./impact";
import { classifyTree, findGaps, isSourceFile, parseOpenApiSpec } from "@edge-spec/core/scanner";
import {
  assertTestOnly,
  evaluatePullPolicy,
  policyBlocked,
  type PullPolicy,
} from "@edge-spec/core/policy";
import { getMemory, getPolicy, runsDb } from "./db";
import { sandboxRepo, runInSandbox } from "@edge-spec/core/sandbox";
import { validateTest } from "@edge-spec/core/validate";
import type { Env } from "./env";
import type { Generation, TestRunner, Validation } from "@edge-spec/core/types";

export interface WorkflowParams {
  repo: string;
  ref: string;
  /** From the webhook payload. Not a secret, so it may be persisted. */
  installationId?: number;
  /** `push` generates, `pull_request` checks, `pr_command` answers a comment. */
  event?: "push" | "pull_request" | "pr_command";
  pullRequest?: number;
  /** The PR head commit the check annotates. */
  headSha?: string;
  /** Parsed `/edgespec …` command. Never contains a secret. */
  command?: {
    name: "retest" | "coverage" | "explain";
    argument?: string;
    commentId?: number;
    login?: string;
  };
  provider?: string;
  model?: string;
  maxRetries?: number;
  autoPr?: boolean;
  strictTypes?: boolean;
  coverageTarget?: number;
}

/** Tokens are per isolate; a restart only costs one mint request. */
const installationTokens = new InstallationTokenCache();

/** A single-quoted shell word, so a repository path cannot inject a command. */
const shellWord = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

interface Scanned {
  path: string;
  testPath: string;
  source: string;
  scanned: number;
  gaps: number;
  runner: TestRunner;
  packageManager: string;
}

export class TestGenerationWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  /** Classifies the changed paths once; used by both checks and commands. */
  private async scanChanged(input: {
    github: GitHub;
    repo: string;
    ref: string;
    changed: string[];
    step: WorkflowStep;
  }) {
    return input.step.do("scan-changed", async () => {
      const tree = await input.github.tree(input.repo, input.ref);
      const blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
      const classification = classifyTree(blobs);
      const changedSet = new Set(input.changed);
      const gaps = classification.missing.filter((gap) => changedSet.has(gap.path));
      const affected = new Set<string>();
      for (const path of input.changed) {
        if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(path)) affected.add(path);
        for (const test of classification.testsBySource.get(path) ?? []) affected.add(test);
      }
      return {
        gaps,
        affectedTests: [...affected],
        sources: input.changed.filter(isSourceFile),
        testsBySource: input.changed.map((path) => ({
          path,
          tests: classification.testsBySource.get(path) ?? [],
        })),
      };
    });
  }

  /** Runs the changed files' existing tests, when a runner exists. */
  private async runAffected(input: {
    repo: string;
    ref: string;
    tests: string[];
    step: WorkflowStep;
    coverage?: boolean;
  }) {
    const runnerUrl = this.env.SANDBOX_RUNNER_URL?.trim();
    if (!runnerUrl || input.tests.length === 0) return undefined;
    return input.step.do(input.coverage ? "run-coverage-tests" : "run-affected-tests", async () => {
      const started = Date.now();
      const sandbox = {
        url: runnerUrl,
        v2: true,
        ...(this.env.SANDBOX_API_KEY ? { apiKey: this.env.SANDBOX_API_KEY } : {}),
      };
      const repoArg = sandboxRepo({ repo: input.repo, ref: input.ref, sandbox });
      const run = await runInSandbox({
        sandbox,
        ...(repoArg ? { repo: repoArg } : {}),
        command: `bun test ${input.tests.map(shellWord).join(" ")}`,
        ...(input.coverage ? { coverage: { format: "lcov" as const } } : {}),
      });
      return {
        ok: run.ok,
        output: run.output,
        durationMs: Date.now() - started,
        executed: !run.unreachable && !run.environmentError,
        ...(run.coverage ? { coverage: run.coverage } : {}),
      };
    });
  }

  /** Direct and transitive test dependents, built from test import closures. */
  private async impactFor(input: {
    github: GitHub;
    repo: string;
    ref: string;
    changed: string[];
    step: WorkflowStep;
  }) {
    return input.step.do("impact-graph", async () => {
      const tree = await input.github.tree(input.repo, input.ref);
      const blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
      return impactForChanges({
        github: input.github,
        repo: input.repo,
        ref: input.ref,
        blobs,
        changed: input.changed,
      });
    });
  }

  /**
   * Advisory PR check. Changed sources plus their test dependents: report
   * changed sources without tests, run the selected tests when a runner exists,
   * then upsert one check and one comment.
   */
  private async checkPullRequest(input: {
    github: GitHub;
    repo: string;
    ref: string;
    number: number;
    step: WorkflowStep;
  }) {
    const changed = await input.step.do("changed-files", () =>
      input.github.pullFiles(input.repo, input.number),
    );

    const scan = await this.scanChanged({
      github: input.github,
      repo: input.repo,
      ref: input.ref,
      changed,
      step: input.step,
    });
    const impact = await this.impactFor({
      github: input.github,
      repo: input.repo,
      ref: input.ref,
      changed,
      step: input.step,
    });
    const affectedTests =
      impact.tests.length > 0 ? impact.tests.map((item) => item.test) : scan.affectedTests;
    const testRun = await this.runAffected({
      repo: input.repo,
      ref: input.ref,
      tests: affectedTests,
      step: input.step,
    });

    const check = buildPrCheck({
      changedFiles: changed,
      gaps: scan.gaps,
      affectedTests,
      impact: impact.tests,
      partialImpact: impact.partial,
      runner: Boolean(this.env.SANDBOX_RUNNER_URL?.trim()) && (!testRun || testRun.executed),
      ...(testRun ? { testRun } : {}),
    });

    await input.step.do("publish-check", async () => {
      const checkId = await input.github.upsertCheck(input.repo, input.ref, check);
      const commentId = await input.github.upsertPullComment(
        input.repo,
        input.number,
        check.comment,
      );
      return { checkId, commentId };
    });

    return {
      status: "checked",
      conclusion: check.conclusion,
      gaps: scan.gaps.length,
      changed: changed.length,
      executed: Boolean(testRun?.executed),
    };
  }

  /** Answers one authorized `/edgespec` comment: one reply, one updated check. */
  private async runCommand(input: {
    github: GitHub;
    repo: string;
    number: number;
    command: NonNullable<WorkflowParams["command"]>;
    step: WorkflowStep;
  }) {
    const pull = await input.step.do("resolve-pull", () =>
      input.github.pullHead(input.repo, input.number),
    );
    const changed = await input.step.do("changed-files", () =>
      input.github.pullFiles(input.repo, input.number),
    );
    const scan = await this.scanChanged({
      github: input.github,
      repo: input.repo,
      ref: pull.sha,
      changed,
      step: input.step,
    });
    const impact = await this.impactFor({
      github: input.github,
      repo: input.repo,
      ref: pull.sha,
      changed,
      step: input.step,
    });
    const affectedTests =
      impact.tests.length > 0 ? impact.tests.map((item) => item.test) : scan.affectedTests;

    let check: PrCheckResult;
    if (input.command.name === "retest") {
      const testRun = await this.runAffected({
        repo: input.repo,
        ref: pull.sha,
        tests: affectedTests,
        step: input.step,
      });
      check = buildPrCheck({
        changedFiles: changed,
        gaps: scan.gaps,
        affectedTests,
        impact: impact.tests,
        partialImpact: impact.partial,
        runner: Boolean(this.env.SANDBOX_RUNNER_URL?.trim()) && (!testRun || testRun.executed),
        ...(testRun ? { testRun } : {}),
      });
    } else if (input.command.name === "coverage") {
      const testRun = await this.runAffected({
        repo: input.repo,
        ref: pull.sha,
        tests: affectedTests,
        step: input.step,
        coverage: true,
      });
      const lines: string[] = [];
      if (!this.env.SANDBOX_RUNNER_URL?.trim()) {
        lines.push("- Not measured: no runner is configured.");
      } else if (!testRun) {
        lines.push("- No affected test file was found for the changed sources.");
      } else if (!testRun.executed) {
        lines.push("- Not measured: the runner could not execute the tests.");
      } else if (!testRun.coverage) {
        lines.push("- Not measured: the runner returned no LCOV report.");
      } else {
        for (const path of scan.sources) {
          const file = coverageForFile(testRun.coverage, path);
          if (!file) {
            lines.push(`- \`${path}\`: not in the LCOV report.`);
            continue;
          }
          const rate =
            file.lines.total > 0 ? Math.round((file.lines.covered / file.lines.total) * 100) : 100;
          const branches = file.branches
            ? ` · branches ${file.branches.covered}/${file.branches.total}`
            : "";
          lines.push(
            `- \`${path}\`: ${file.lines.covered}/${file.lines.total} lines (${rate}%)${branches}.`,
          );
        }
        if (scan.sources.length === 0) lines.push("- No changed source file to measure.");
      }
      const summary = [
        "## EdgeSpec coverage",
        "",
        ...lines,
        "",
        "One measured report from the changed files' existing tests. This is not a delta.",
      ].join("\n");
      check = {
        conclusion: "neutral",
        output: { title: "EdgeSpec · coverage", summary, annotations: [] },
        comment: summary,
      };
    } else {
      const summary = await this.explainCommand({
        github: input.github,
        repo: input.repo,
        ref: pull.sha,
        argument: input.command.argument ?? "",
        scan,
        step: input.step,
      });
      check = {
        conclusion: "neutral",
        output: { title: "EdgeSpec · explain", summary, annotations: [] },
        comment: summary,
      };
    }

    await input.step.do("publish-command", async () => {
      const checkId = await input.github.upsertCheck(input.repo, pull.sha, check);
      const commentId = await input.github.commentOnPull(
        input.repo,
        input.number,
        `${check.output.summary}\n\n<!-- edgespec:command -->`,
      );
      return { checkId, commentId };
    });

    return {
      status: "command",
      command: input.command.name,
      conclusion: check.conclusion,
    };
  }

  /** Deterministic file or OpenAPI explanation; no AI is spent. */
  private async explainCommand(input: {
    github: GitHub;
    repo: string;
    ref: string;
    argument: string;
    scan: {
      gaps: Array<{ path: string; testPath: string; risk: string; reason: string }>;
      sources: string[];
    };
    step: WorkflowStep;
  }): Promise<string> {
    const target = input.argument.trim();
    const endpoint = /^([A-Za-z]+)\s+(\/\S*)$/.exec(target);
    const tree = await input.step.do("explain-tree", async () => {
      const list = await input.github.tree(input.repo, input.ref);
      return list.filter((entry) => entry.type === "blob").map((entry) => entry.path);
    });

    if (endpoint) {
      const method = (endpoint[1] ?? "").toUpperCase();
      const path = endpoint[2] ?? "";
      const specs = tree.filter((item) =>
        /(^|\/)(openapi|swagger|api[-_.]?spec)[^/]*\.(json|ya?ml)$/i.test(item),
      );
      let found:
        | {
            specPath: string;
            title?: string;
            responses?: string[];
            parameters?: Array<{ name?: string; in?: string; required?: boolean }>;
          }
        | undefined;
      for (const specPath of specs.slice(0, 4)) {
        try {
          const spec = parseOpenApiSpec(
            await input.github.file(input.repo, specPath, input.ref),
            specPath,
          );
          const operation = spec?.endpoints.find(
            (item) => item.method.toUpperCase() === method && item.path === path,
          );
          if (spec && operation) {
            found = {
              specPath,
              ...(spec.title ? { title: spec.title } : {}),
              ...(operation.responses ? { responses: operation.responses } : {}),
              ...(operation.parameters
                ? {
                    parameters: operation.parameters.map((parameter) => ({
                      name: parameter.name,
                      in: parameter.in,
                      required: parameter.required === true,
                    })),
                  }
                : {}),
            };
            break;
          }
        } catch {
          // A spec we cannot parse is a spec we cannot explain.
        }
      }
      if (!found) {
        return `## EdgeSpec explain · ${method} ${path}\n\nNo OpenAPI operation with this method and path was found in this commit.`;
      }
      const parameters = found.parameters?.length
        ? found.parameters
            .map(
              (parameter) =>
                `${parameter.name} (${parameter.in}${parameter.required ? ", required" : ""})`,
            )
            .join(", ")
        : "none";
      return [
        `## EdgeSpec explain · ${method} ${path}`,
        "",
        `- Spec: \`${found.specPath}\`${found.title ? ` (${found.title})` : ""}.`,
        `- Contract test: \`${contractPathFor(found.specPath)}\` when the spec is in scope.`,
        `- Responses: ${found.responses?.join(", ") || "not documented"}.`,
        `- Parameters: ${parameters}.`,
      ].join("\n");
    }

    const path = target.replace(/^`|`$/g, "").replace(/^\.\//, "");
    if (!tree.includes(path)) {
      return `## EdgeSpec explain · \`${path}\`\n\nNo file with this path exists in this commit.`;
    }
    const gap = input.scan.gaps.find((item) => item.path === path);
    if (gap) {
      return [
        `## EdgeSpec explain · \`${path}\``,
        "",
        `- No test found. Expected \`${gap.testPath}\`.`,
        `- Risk: ${gap.risk}.`,
        `- Reason: ${gap.reason}`,
        "- This is a path heuristic, not a measured coverage number.",
      ].join("\n");
    }
    const tests = tree.filter((item) =>
      new RegExp(
        `(^|/)${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\.(ts|tsx|js|jsx)$/i, "")}\\.(test|spec)\\.[cm]?[jt]sx?$`,
        "i",
      ).test(item),
    );
    if (tests.length > 0) {
      return [
        `## EdgeSpec explain · \`${path}\``,
        "",
        `- Existing tests: ${tests.map((test) => `\`${test}\``).join(", ")}.`,
        "- No missing-test gap was recorded for this changed file.",
      ].join("\n");
    }
    return `## EdgeSpec explain · \`${path}\`\n\nThis path is not a changed source with a missing test in this commit.`;
  }

  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
    const params = event.payload;
    const repo = params.repo;
    const ref = params.ref;
    const app = gitHubAppFromEnv(this.env);
    const token =
      app && params.installationId && params.installationId > 0
        ? await installationTokens.get(app, params.installationId, repo)
        : this.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error(
        "The webhook has no GitHub credential. Configure the GitHub App secrets or GITHUB_TOKEN.",
      );
    }
    const github = new GitHub(token);
    const memoryDb = runsDb(this.env);
    const memory = memoryDb ? await getMemory(memoryDb, repo).catch(() => undefined) : undefined;

    if (params.event === "pr_command" && params.pullRequest && params.command) {
      return this.runCommand({
        github,
        repo,
        number: params.pullRequest,
        command: params.command,
        step,
      });
    }

    // A pull request is a read-only check: no generation, no branch, no PR.
    if (params.event === "pull_request" && params.pullRequest) {
      return this.checkPullRequest({
        github,
        repo,
        ref: params.headSha?.trim() || ref,
        number: params.pullRequest,
        step,
      });
    }

    const config = pipelineConfig(params);
    const provider = providerById(params.provider ?? DEFAULT_AI.provider);
    if (!provider) throw new Error(`Unknown provider: ${params.provider}`);
    if (provider.id !== "workers-ai") {
      throw new Error("Webhook automation runs on Workers AI. Use the dashboard for BYO keys.");
    }
    const model = params.model ?? DEFAULT_AI.model;

    const scanned = await step.do("scan-repository", async (): Promise<Scanned | null> => {
      const tree = await github.tree(repo, ref);
      const blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
      const gaps = findGaps(blobs, 1);
      const gap = gaps[0];
      if (!gap) return null;
      const source = await github.file(repo, gap.path, ref);
      const packageJson = await github.file(repo, "package.json", ref).catch(() => undefined);
      return {
        path: gap.path,
        testPath: gap.testPath,
        source,
        scanned: blobs.length,
        gaps: gaps.length,
        runner: detectRunner({
          paths: blobs,
          ...(packageJson ? { packageJson } : {}),
        }),
        packageManager: detectPackageManager(blobs),
      };
    });

    if (!scanned) return { status: "completed", message: "No missing tests found." };

    let generation = await step.do(
      "generate-test",
      async (): Promise<Generation> => {
        const code = await generateTest({
          filePath: scanned.path,
          source: scanned.source,
          runner: scanned.runner,
          ...(memory ? { memory } : {}),
          config: {
            provider,
            model,
            ...(this.env.AI ? { ai: this.env.AI } : {}),
          },
        });
        return {
          sourcePath: scanned.path,
          testPath: scanned.testPath,
          code,
          provider: provider.id,
          model,
          corrected: false,
          promptVersion: PROMPT_VERSION,
        };
      },
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } },
    );

    let validation = await step.do("validate-test", async (): Promise<Validation> => {
      return validateTest({
        sourcePath: scanned.path,
        source: scanned.source,
        testPath: scanned.testPath,
        test: generation.code,
        strictTypes: config.strictTypes,
        flakyRuns: config.flakyRuns,
        runner: scanned.runner,
        packageManager: scanned.packageManager,
        mutationCommand: config.mutationCommand,
        ...(this.env.SANDBOX_RUNNER_URL
          ? {
              sandbox: {
                url: this.env.SANDBOX_RUNNER_URL,
                ...(this.env.SANDBOX_API_KEY ? { apiKey: this.env.SANDBOX_API_KEY } : {}),
              },
            }
          : {}),
      });
    });

    for (let attempt = 0; !validation.ok && attempt < config.maxRetries; attempt += 1) {
      const previous = { code: generation.code, output: validation.output };
      generation = await step.do(`correct-test-${attempt + 1}`, async (): Promise<Generation> => {
        const code = await generateTest({
          filePath: scanned.path,
          source: scanned.source,
          runner: scanned.runner,
          ...(memory ? { memory } : {}),
          config: {
            provider,
            model,
            ...(this.env.AI ? { ai: this.env.AI } : {}),
          },
          previous,
        });
        return { ...generation, code, corrected: true };
      });
      validation = await step.do(
        `revalidate-test-${attempt + 1}`,
        async (): Promise<Validation> => {
          return validateTest({
            sourcePath: scanned.path,
            source: scanned.source,
            testPath: scanned.testPath,
            test: generation.code,
            strictTypes: config.strictTypes,
            flakyRuns: config.flakyRuns,
            runner: scanned.runner,
            packageManager: scanned.packageManager,
            mutationCommand: config.mutationCommand,
            ...(this.env.SANDBOX_RUNNER_URL
              ? {
                  sandbox: {
                    url: this.env.SANDBOX_RUNNER_URL,
                    ...(this.env.SANDBOX_API_KEY ? { apiKey: this.env.SANDBOX_API_KEY } : {}),
                  },
                }
              : {}),
          });
        },
      );
    }

    if (!validation.ok) {
      return { status: "failed", reason: validation.output, path: scanned.path };
    }
    if (!config.autoPr) {
      return { status: "ready", path: scanned.path, testPath: scanned.testPath };
    }

    // Server-side policy is opt-in: no D1 row means no extra gates.
    const db = runsDb(this.env);
    const policy: PullPolicy = db ? await step.do("load-policy", () => getPolicy(db, repo)) : {};
    const policyFiles = [
      {
        path: scanned.testPath,
        ...(validation.coverage ? { coverage: validation.coverage } : {}),
      },
    ];
    const blocked = policyBlocked(
      evaluatePullPolicy(policy, {
        files: policyFiles,
        ...(policy.draftOnly ? { draft: true } : {}),
      }),
    );
    if (blocked) return { status: "blocked", reason: blocked };

    const pullRequestUrl = await step.do("create-pull-request", async (): Promise<string> => {
      const base = await github.defaultBranch(repo);
      const sha = await github.headSha(repo, base);
      const branch = `edgespec/test-${scanned.path
        .slice(scanned.path.lastIndexOf("/") + 1)
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .toLowerCase()}-${Date.now()}`;

      await github.createBranch(repo, branch, sha);
      assertTestOnly(scanned.testPath);
      await github.putFile(
        repo,
        scanned.testPath,
        generation.code,
        `test: add generated tests for ${scanned.path}`,
        branch,
      );
      const url = await github.openPull(repo, {
        title: `test: add unit tests for ${scanned.path}`,
        head: branch,
        base,
        body: `### EdgeSpec\n\nGenerated unit tests for \`${scanned.path}\` with ${model}.`,
        ...(policy.draftOnly ? { draft: true } : {}),
      });
      const number = Number(/\/pull\/(\d+)\/?$/.exec(url)?.[1]);
      if (number > 0) {
        if (policy.labels?.length) {
          await github.addLabels(repo, number, policy.labels).catch(() => undefined);
        }
        if (policy.reviewers?.length) {
          await github.requestReviewers(repo, number, policy.reviewers).catch(() => undefined);
        }
      }
      return url;
    });

    return {
      status: "success",
      pullRequestUrl,
      path: scanned.path,
      verified: validation.verified,
    };
  }
}
