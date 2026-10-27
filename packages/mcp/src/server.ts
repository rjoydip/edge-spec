import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
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

interface PendingPull {
  repo: string;
  files: Array<{ path: string; code: string; sourcePath?: string }>;
  strictTypes?: boolean;
  expiresAt: number;
}

export function createServer(env: Env, options: { fetchImpl?: typeof fetch } = {}): McpServer {
  const server = new McpServer({ name: "edgespec", version: "0.1.0" });
  /** Prepared requests await an explicit one-time approval token. */
  const approvals = new Map<string, PendingPull>();

  const clientFor = (selectedProvider?: string): EdgeSpecClient => {
    return new EdgeSpecClient({
      ...clientConfigFromEnv(env, selectedProvider),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
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
    "edgespec_prepare_pull_request",
    {
      title: "Prepare a pull request for approval",
      description:
        "Validates the supplied test files and returns a one-time approval token and a readable summary. This does not write to GitHub. Show the summary to the user, then call edgespec_open_pull_request with the token only after they approve.",
      inputSchema: {
        repo,
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
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const approvalId = crypto.randomUUID();
        const expiresAt = Date.now() + 10 * 60_000;
        approvals.set(approvalId, {
          repo: args.repo,
          files: args.files,
          ...(args.strictTypes !== undefined ? { strictTypes: args.strictTypes } : {}),
          expiresAt,
        });
        // Old approvals must not accumulate in a long-lived stdio session.
        for (const [id, pending] of approvals) {
          if (pending.expiresAt <= Date.now()) approvals.delete(id);
        }
        return ok({
          approvalId,
          expiresAt: new Date(expiresAt).toISOString(),
          repo: args.repo,
          files: args.files.map((file) => file.path),
          summary: `Open a pull request in ${args.repo} with ${args.files.length} test file(s).`,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "edgespec_open_pull_request",
    {
      title: "Open an approved pull request",
      description:
        "Creates a branch and opens the prepared pull request. Requires a one-time approvalId from edgespec_prepare_pull_request; the token is consumed on use.",
      inputSchema: {
        approvalId: z
          .string()
          .min(1)
          .describe("The approval id returned by edgespec_prepare_pull_request."),
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
        const pending = approvals.get(args.approvalId);
        if (!pending || pending.expiresAt <= Date.now()) {
          approvals.delete(args.approvalId);
          return fail(
            "The approval is missing or expired. Call edgespec_prepare_pull_request again and ask the user to approve.",
          );
        }
        approvals.delete(args.approvalId);
        return ok(
          await clientFor().openPullRequest({
            repo: pending.repo,
            files: pending.files,
            ...(pending.strictTypes !== undefined ? { strictTypes: pending.strictTypes } : {}),
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  const resource = async (uri: URL, value: unknown) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  });

  server.registerResource(
    "edgespec_gaps",
    new ResourceTemplate("edgespec://gaps/{owner}/{name}", { list: undefined }),
    {
      title: "Repository gaps",
      description: "Missing tests and contract gaps for a GitHub repository.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const result = await clientFor().scan({
        repo: `${String(variables.owner)}/${String(variables.name)}`,
      });
      return resource(uri, {
        repo: result.repo,
        ref: result.ref,
        gaps: result.gaps,
        apiGaps: result.apiGaps ?? [],
        unsupported: result.unsupported ?? [],
        totals: result.totals,
      });
    },
  );

  server.registerResource(
    "edgespec_specs",
    new ResourceTemplate("edgespec://specs/{owner}/{name}", { list: undefined }),
    {
      title: "OpenAPI specs",
      description: "Parsed OpenAPI documents found by a scan, or an empty list.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const result = await clientFor().scan({
        repo: `${String(variables.owner)}/${String(variables.name)}`,
      });
      return resource(uri, {
        repo: result.repo,
        ref: result.ref,
        specs: result.overview?.openApiSpecs ?? [],
        artifacts: result.overview?.apiArtifacts ?? [],
      });
    },
  );

  server.registerResource(
    "edgespec_coverage",
    new ResourceTemplate("edgespec://coverage/{owner}/{name}", { list: undefined }),
    {
      title: "Coverage status",
      description: "Coverage gaps and status from a scan; not-run when no runner report exists.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const result = await clientFor().scan({
        repo: `${String(variables.owner)}/${String(variables.name)}`,
      });
      return resource(uri, {
        repo: result.repo,
        ref: result.ref,
        status: result.coverageStatus ?? "not-run",
        reason: result.coverageReason,
        gaps: result.coverageGaps ?? [],
      });
    },
  );

  server.registerResource(
    "edgespec_run_status",
    new ResourceTemplate("edgespec://runs/{id}", { list: undefined }),
    {
      title: "Workflow run status",
      description: "Durable workflow status for a webhook run id.",
      mimeType: "application/json",
    },
    async (uri, variables) => resource(uri, await clientFor().runStatus(String(variables.id))),
  );

  return server;
}
