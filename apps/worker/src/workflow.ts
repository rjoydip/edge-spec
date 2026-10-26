/**
 * The durable path for GitHub webhooks: it scans a repository, writes the
 * missing test, checks it and opens the pull request. It runs with
 * deployment-owned credentials (Workers AI + GITHUB_TOKEN) because Workflow
 * params are persisted; a visitor's API key must never end up in that state.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { generateTest } from "@edge-spec/core/ai";
import { DEFAULT_AI, pipelineConfig, providerById } from "@edge-spec/core/catalog";
import { GitHub } from "@edge-spec/core/github";
import { InstallationTokenCache, gitHubAppFromEnv } from "@edge-spec/core/github-app";
import { buildPrCheck } from "@edge-spec/core/pr-check";
import { classifyTree, findGaps } from "@edge-spec/core/scanner";
import {
  assertTestOnly,
  evaluatePullPolicy,
  policyBlocked,
  type PullPolicy,
} from "@edge-spec/core/policy";
import { getPolicy, runsDb } from "./db";
import { sandboxRepo, runInSandbox } from "@edge-spec/core/sandbox";
import { validateTest } from "@edge-spec/core/validate";
import type { Env } from "./env";
import type { Generation, Validation } from "@edge-spec/core/types";

export interface WorkflowParams {
  repo: string;
  ref: string;
  /** From the webhook payload. Not a secret, so it may be persisted. */
  installationId?: number;
  /** `push` generates and may open a PR; `pull_request` only publishes a check. */
  event?: "push" | "pull_request";
  pullRequest?: number;
  /** The PR head commit the check annotates. */
  headSha?: string;
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
}

export class TestGenerationWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  /**
   * Advisory PR check. Changed files only (the import graph is not built yet):
   * report changed sources without tests, run their existing tests when a
   * runner exists, then upsert one check and one comment.
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

    const scan = await input.step.do("scan-changed", async () => {
      const tree = await input.github.tree(input.repo, input.ref);
      const blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
      const classification = classifyTree(blobs);
      const changedSet = new Set(changed);
      const gaps = classification.missing.filter((gap) => changedSet.has(gap.path));
      const affected = new Set<string>();
      for (const path of changed) {
        if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(path)) affected.add(path);
        for (const test of classification.testsBySource.get(path) ?? []) affected.add(test);
      }
      return { gaps, affectedTests: [...affected], scanned: blobs.length };
    });

    const runnerUrl = this.env.SANDBOX_RUNNER_URL?.trim();
    const testRun =
      runnerUrl && scan.affectedTests.length > 0
        ? await input.step.do("run-affected-tests", async () => {
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
              command: `bun test ${scan.affectedTests.map(shellWord).join(" ")}`,
            });
            return {
              ok: run.ok,
              output: run.output,
              durationMs: Date.now() - started,
              executed: !run.unreachable && !run.environmentError,
            };
          })
        : undefined;

    const check = buildPrCheck({
      changedFiles: changed,
      gaps: scan.gaps,
      affectedTests: scan.affectedTests,
      runner: Boolean(runnerUrl) && (!testRun || testRun.executed),
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
      return {
        path: gap.path,
        testPath: gap.testPath,
        source,
        scanned: blobs.length,
        gaps: gaps.length,
      };
    });

    if (!scanned) return { status: "completed", message: "No missing tests found." };

    let generation = await step.do(
      "generate-test",
      async (): Promise<Generation> => {
        const code = await generateTest({
          filePath: scanned.path,
          source: scanned.source,
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
