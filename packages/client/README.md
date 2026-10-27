# @edge-spec/client

HTTP client for the EdgeSpec Worker API, shared by the CLI and MCP server. It
may import core types but never calls the core pipeline directly, so every
client sees the same behaviour as the dashboard and the deployment.

```ts
import { EdgeSpecClient, clientConfigFromEnv } from "@edge-spec/client";

const client = new EdgeSpecClient(clientConfigFromEnv(process.env, "openai"));
const scan = await client.scan({ repo: "acme/api", ref: "main" });
```

`env.ts` maps `EDGESPEC_*` variables and provider keys to request headers;
`run.ts` collects streamed run events. Secrets come from the environment only.

```bash
bun test packages/client
bun run --filter @edge-spec/client typecheck
```
