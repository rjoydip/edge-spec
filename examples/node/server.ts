import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("hello from node");
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}

export function createApp() {
  return createServer(handler);
}
