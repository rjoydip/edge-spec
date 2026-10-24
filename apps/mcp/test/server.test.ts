import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";

async function connect(env: Record<string, string | undefined>) {
  const server = createServer(env);
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
        "edgespec_run",
        "edgespec_scan",
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("refuses to open a pull request without confirmation", async () => {
    const { client, server } = await connect({});
    try {
      const result = await client.callTool({
        name: "edgespec_open_pull_request",
        arguments: {
          repo: "owner/repo",
          confirm: false,
          files: [{ path: "src/a.test.ts", code: "test" }],
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("confirm: true");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
