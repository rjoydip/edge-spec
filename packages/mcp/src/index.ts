#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

const help = `EdgeSpec MCP server

Runs a stdio MCP server that exposes the configured EdgeSpec deployment:
  edgespec_catalog
  edgespec_scan
  edgespec_generate
  edgespec_run
  edgespec_prepare_pull_request
  edgespec_open_pull_request

Resources:
  edgespec://gaps/{owner}/{name}
  edgespec://specs/{owner}/{name}
  edgespec://coverage/{owner}/{name}
  edgespec://runs/{id}

Environment:
  EDGESPEC_URL                 EdgeSpec Worker URL (default: http://127.0.0.1:8787)
  GH_TOKEN                 GitHub token (GITHUB_TOKEN / EDGESPEC_GITHUB_TOKEN are aliases)
  EDGESPEC_AI_PROVIDER         Default provider id
  EDGESPEC_AI_MODEL            Default model id
  EDGESPEC_AI_KEY              Provider key; provider-specific keys also work
  EDGESPEC_AI_BASE_URL         Base URL for the private provider
  CLOUDFLARE_ACCOUNT_ID        Workers AI BYOK account id
  EDGESPEC_SANDBOX_URL         Sandbox URL
  EDGESPEC_SANDBOX_KEY         Test runner key
  EDGESPEC_DEPLOYMENT_AI=1     Use the deployment's Workers AI binding

Start it from an MCP client with:
  bun /absolute/path/to/edge-spec/packages/mcp/src/index.ts
`;

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(help);
    return;
  }

  const server = createServer(process.env);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("EdgeSpec MCP server running on stdio.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(
    `EdgeSpec MCP server failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
