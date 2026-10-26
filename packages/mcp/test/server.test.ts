import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";

async function connect(
  env: Record<string, string | undefined>,
  options: { fetchImpl?: typeof fetch } = {},
) {
  const server = createServer(env, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "edgespec-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}

describe("EdgeSpec MCP server", () => {
  it("registers the EdgeSpec tools", async () => {
    const { client, server } = await connect({});
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "edgespec_catalog",
        "edgespec_generate",
        "edgespec_open_pull_request",
        "edgespec_prepare_pull_request",
        "edgespec_run",
        "edgespec_scan",
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("refuses to open a pull request without a prepared approval", async () => {
    const { client, server } = await connect({});
    try {
      const result = await client.callTool({
        name: "edgespec_open_pull_request",
        arguments: { approvalId: "missing" },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("edgespec_prepare_pull_request");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("opens only with a one-time approval token", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return Response.json({ url: "https://github.com/owner/repo/pull/1", files: 1 });
    }) as unknown as typeof fetch;
    const { client, server } = await connect({}, { fetchImpl });
    try {
      const prepared = await client.callTool({
        name: "edgespec_prepare_pull_request",
        arguments: { repo: "owner/repo", files: [{ path: "src/a.test.ts", code: "test" }] },
      });
      const content = prepared.content as Array<{ text?: string }>;
      const approvalId = (JSON.parse(content[0]?.text ?? "{}") as { approvalId?: string })
        .approvalId;
      expect(approvalId).toBeDefined();

      const opened = await client.callTool({
        name: "edgespec_open_pull_request",
        arguments: { approvalId },
      });
      expect(opened.isError).toBeFalsy();
      expect(calls[0]).toContain("/api/pull-request");

      const reused = await client.callTool({
        name: "edgespec_open_pull_request",
        arguments: { approvalId },
      });
      expect(reused.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registers resource templates for gaps, specs, coverage and runs", async () => {
    const { client, server } = await connect({});
    try {
      const templates = await client.listResourceTemplates();
      expect(templates.resourceTemplates.map((template) => template.uriTemplate).sort()).toEqual([
        "edgespec://coverage/{owner}/{name}",
        "edgespec://gaps/{owner}/{name}",
        "edgespec://runs/{id}",
        "edgespec://specs/{owner}/{name}",
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
