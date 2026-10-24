import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  EdgeSpecClient,
  clientConfigFromEnv,
  collectGenerations,
  envDefaults,
  finalResult,
  folderFirst,
  type Env,
  type EnvDefaults,
} from "@edge-spec/client";
import { z } from "zod";

const repo = z.string().min(1).describe("GitHub repository as owner/name.");
const ref = z.string().optional().describe("Branch or tag. Defaults to main.");
const provider = z
  .string()
  .optional()
  .describe("AI provider id from edgespec_catalog. Defaults to EDGESPEC_AI_PROVIDER.");
const model = z
  .string()
  .optional()
  .describe("AI model id from edgespec_catalog. Defaults to EDGESPEC_AI_MODEL.");
const accountId = z
  .string()
  .optional()
  .describe("Cloudflare account id for Workers AI BYOK. Defaults to CLOUDFLARE_ACCOUNT_ID.");
const strictTypes = z
  .boolean()
  .optional()
  .describe("Run strict TypeScript checks during validation. Defaults to true.");

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "edgespec", version: "0.1.0" });

  const clientFor = (selectedProvider?: string): EdgeSpecClient => {
    return new EdgeSpecClient(clientConfigFromEnv(env, selectedProvider));
  };

  const defaultsFor = (selectedProvider?: string): EnvDefaults =>
    envDefaults(env, selectedProvider);

  const ai = (
    args: { provider?: string; model?: string; accountId?: string },
    defaults: EnvDefaults,
  ): { provider?: string; model?: string; accountId?: string } => {
    const selectedProvider = args.provider ?? defaults.provider;
    const selectedModel = args.model ?? defaults.model;
    const selectedAccount = args.accountId ?? defaults.accountId;
    return {
      ...(selectedProvider ? { provider: selectedProvider } : {}),
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(selectedAccount ? { accountId: selectedAccount } : {}),
    };
  };

  server.registerTool(
    "edgespec_catalog",
    {
      title: "List EdgeSpec providers and models",
      description:
        "Returns the AI providers, models, pipeline defaults, and sandbox availability of the configured EdgeSpec deployment. Read-only.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return ok(await clientFor().catalog());
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "edgespec_scan",
    {
      title: "Scan a repository for missing tests",
      description:
        "Scans a GitHub repository for source files without a sibling test. Returns the gaps, exported symbols, risk heuristics, and repository overview. Read-only.",
      inputSchema: {
        repo,
        ref,
        folder: z.string().optional().describe("Prioritize gaps under this folder."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of gaps to return."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const result = await clientFor().scan({
          repo: args.repo,
          ...(args.ref ? { ref: args.ref } : {}),
        });
        let gaps = folderFirst(result.gaps, args.folder);
        if (args.limit !== undefined) gaps = gaps.slice(0, args.limit);
        return ok({ ...result, gaps });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "edgespec_generate",
    {
      title: "Generate and validate one test",
      description:
        "Generates a test for one source file with the configured AI provider, validates it, and returns the code plus validation details. This calls the AI provider and may take a minute.",
      inputSchema: {
        repo,
        path: z.string().min(1).describe("Source file path inside the repository."),
        ref,
        provider,
        model,
        accountId,
        coverageTarget: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe("Advisory branch-coverage target for the prompt."),
        strictTypes,
        maxRetries: z
          .number()
          .int()
          .min(0)
          .max(5)
          .optional()
          .describe("Self-correction attempts after a failed validation."),
        maxAiRetries: z
          .number()
          .int()
          .min(0)
          .max(5)
          .optional()
          .describe("Retries when the AI provider is unreachable."),
        previous: z
          .object({ code: z.string(), output: z.string() })
          .optional()
          .describe("A previous attempt and its runner output, for self-correction."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        const defaults = defaultsFor(args.provider);
        const result = await clientFor(args.provider).generate({
          repo: args.repo,
          path: args.path,
          ...(args.ref ? { ref: args.ref } : {}),
          ...ai(args, defaults),
          ...(args.coverageTarget !== undefined ? { coverageTarget: args.coverageTarget } : {}),
          ...(args.strictTypes !== undefined ? { strictTypes: args.strictTypes } : {}),
          ...(args.maxRetries !== undefined ? { maxRetries: args.maxRetries } : {}),
          ...(args.maxAiRetries !== undefined ? { maxAiRetries: args.maxAiRetries } : {}),
          ...(args.previous ? { previous: args.previous } : {}),
        });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "edgespec_run",
    {
      title: "Run the test-generation pipeline",
      description:
        "Scans a repository, generates and validates tests for several gaps, and returns the ready tests with their code and logs. This can take several minutes and calls the AI provider.",
      inputSchema: {
        repo,
        ref,
        provider,
        model,
        accountId,
        coverageTarget: z.number().min(0).max(100).optional(),
        strictTypes,
        maxRetries: z.number().int().min(0).max(5).optional(),
        maxAiRetries: z.number().int().min(0).max(5).optional(),
        maxFiles: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum number of gaps to process."),
        retryGaps: z
          .array(z.string())
          .optional()
          .describe("Source paths to process instead of a fresh scan."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args, extra) => {
      try {
        const defaults = defaultsFor(args.provider);
        const progressToken = extra._meta?.progressToken;
        let progress = 0;
        const events = await clientFor(args.provider).run(
          {
            repo: args.repo,
            ...(args.ref ? { ref: args.ref } : {}),
            ...ai(args, defaults),
            ...(args.coverageTarget !== undefined ? { coverageTarget: args.coverageTarget } : {}),
            ...(args.strictTypes !== undefined ? { strictTypes: args.strictTypes } : {}),
            ...(args.maxRetries !== undefined ? { maxRetries: args.maxRetries } : {}),
            ...(args.maxAiRetries !== undefined ? { maxAiRetries: args.maxAiRetries } : {}),
            ...(args.maxFiles !== undefined ? { maxFiles: args.maxFiles } : {}),
            ...(args.retryGaps?.length ? { retryGaps: args.retryGaps } : {}),
          },
          (event) => {
            if (progressToken === undefined) return;
            progress += 1;
            void extra
              .sendNotification({
                method: "notifications/progress",
                params: { progressToken, progress, message: event.type },
              })
              .catch(() => {});
          },
        );
        const result = finalResult(events);
        if (!result) throw new Error("EdgeSpec finished without a result event.");
        const generated = [...collectGenerations(events).values()];
        const logs = events.flatMap((event) =>
          event.type === "log" ? [{ level: event.level, text: event.text }] : [],
        );
        return ok({ result, generations: generated, logs });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "edgespec_open_pull_request",
    {
      title: "Open a pull request with generated tests",
      description:
        "Creates a branch and opens a pull request containing the supplied test files. This writes to GitHub. Ask the user first and pass confirm: true.",
      inputSchema: {
        repo,
        confirm: z
          .boolean()
          .describe("Must be true. Confirms that the user wants to open a pull request."),
        strictTypes,
        files: z
          .array(
            z.object({
              path: z.string().min(1).describe("Path of the generated test file."),
              code: z.string().min(1).describe("Full contents of the test file."),
              sourcePath: z
                .string()
                .optional()
                .describe("Source file the test covers, used in the commit message."),
            }),
          )
          .min(1)
          .describe("Test files to commit."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        if (args.confirm !== true) {
          return fail("Ask the user first, then call this tool with confirm: true.");
        }
        return ok(
          await clientFor().openPullRequest({
            repo: args.repo,
            files: args.files,
            ...(args.strictTypes !== undefined ? { strictTypes: args.strictTypes } : {}),
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}
