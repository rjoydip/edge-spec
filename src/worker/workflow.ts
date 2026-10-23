/**
 * The durable path for GitHub webhooks: it scans a repository, writes the
 * missing test, checks it and opens the pull request. It runs with
 * deployment-owned credentials (Workers AI + GITHUB_TOKEN) because Workflow
 * params are persisted; a visitor's API key must never end up in that state.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { generateTest } from "../core/ai";
import { DEFAULT_AI, pipelineConfig, providerById } from "../core/catalog";
import { GitHub } from "../core/github";
import { findGaps } from "../core/scanner";
import { validateTest } from "../core/validate";
import type { Env } from "./env";
import type { Generation, Validation } from "../core/types";

export interface WorkflowParams {
  repo: string;
  ref: string;
  provider?: string;
  model?: string;
  maxRetries?: number;
  autoPr?: boolean;
  strictTypes?: boolean;
  coverageTarget?: number;
}

interface Scanned {
  path: string;
  testPath: string;
  source: string;
  scanned: number;
  gaps: number;
}

export class TestGenerationWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
    const params = event.payload;
    const repo = params.repo;
    const ref = params.ref;
    const config = pipelineConfig(params);
    const provider = providerById(params.provider ?? DEFAULT_AI.provider);
    if (!provider) throw new Error(`Unknown provider: ${params.provider}`);
    if (provider.id !== "workers-ai") {
      throw new Error("Webhook automation runs on Workers AI. Use the dashboard for BYO keys.");
    }
    const model = params.model ?? DEFAULT_AI.model;
    const github = new GitHub(this.env.GITHUB_TOKEN);

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

    const pullRequestUrl = await step.do("create-pull-request", async (): Promise<string> => {
      const base = await github.defaultBranch(repo);
      const sha = await github.headSha(repo, base);
      const branch = `edgespec/test-${scanned.path
        .slice(scanned.path.lastIndexOf("/") + 1)
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .toLowerCase()}-${Date.now()}`;

      await github.createBranch(repo, branch, sha);
      await github.putFile(
        repo,
        scanned.testPath,
        generation.code,
        `test: add generated tests for ${scanned.path}`,
        branch,
      );
      return github.openPull(repo, {
        title: `test: add unit tests for ${scanned.path}`,
        head: branch,
        base,
        body: `### EdgeSpec\n\nGenerated unit tests for \`${scanned.path}\` with ${model}.`,
      });
    });

    return {
      status: "success",
      pullRequestUrl,
      path: scanned.path,
      verified: validation.verified,
    };
  }
}
