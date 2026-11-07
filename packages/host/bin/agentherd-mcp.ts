#!/usr/bin/env node
// The `agentherd` stdio MCP server an agent starts (docs/spec/09-agent-tools.md §1). It only
// relays: stdin lines go to the host's MCP socket after a token line, socket lines go to stdout.

import { createConnection } from "node:net";

const socketPath = process.env.AGENTHERD_MCP_SOCKET ?? "";
const token = process.env.AGENTHERD_MCP_TOKEN ?? "";

if (socketPath === "" || token === "") {
  process.stderr.write(
    "agentherd-mcp: AGENTHERD_MCP_SOCKET and AGENTHERD_MCP_TOKEN are required\n",
  );
  process.exit(2);
}

const socket = createConnection(socketPath);
socket.on("connect", () => {
  socket.write(`${JSON.stringify({ token })}\n`);
  process.stdin.pipe(socket);
});
socket.pipe(process.stdout);
socket.on("error", (error) => {
  process.stderr.write(`agentherd-mcp: ${error.message}\n`);
  process.exit(1);
});
socket.on("close", () => process.exit(0));
process.stdin.on("end", () => socket.end());
