// The local socket agents' `agentherd` MCP servers talk to (docs/spec/09-agent-tools.md §1).
// The relay (bin/agentherd-mcp.ts) sends `{"token": …}` as its first line, then JSON-RPC lines.
// No TCP port: a socket file (mode 600 in a 700 directory) or, on Windows, a named pipe.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StdioMcpServer } from "@agentherd/acp-client";
import { type JsonRpcMessage, UnknownTokenError } from "@agentherd/core";
import { nodeEnv } from "./runtimes.ts";

export const MCP_RELAY_BIN = fileURLToPath(new URL("../bin/agentherd-mcp.ts", import.meta.url));
export const UNKNOWN_TOKEN = -32001;
const PARSE_ERROR = -32700;
const INTERNAL_ERROR = -32603;

export function mcpSocketPath(home: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const id = createHash("sha256").update(home.toLowerCase()).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\agentherd-mcp-${id}`;
  }
  return join(home, "run", "mcp.sock");
}

/** The stdio server an agent starts: the relay, run by the host's Node, with socket and token. */
export function mcpServerFor(socket: string, token: string): StdioMcpServer {
  const env = { ...nodeEnv(), AGENTHERD_MCP_SOCKET: socket, AGENTHERD_MCP_TOKEN: token };
  return {
    name: "agentherd",
    command: process.execPath,
    args: [MCP_RELAY_BIN],
    env: Object.entries(env).map(([name, value]) => ({ name, value })),
  };
}

export interface McpServer {
  path: string;
  close(): Promise<void>;
}

export type McpHandler = (token: string, msg: JsonRpcMessage) => JsonRpcMessage | undefined;

const errorLine = (code: number, message: string, id: JsonRpcMessage["id"] = null) =>
  `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`;

function serveSocket(socket: Socket, handle: McpHandler): void {
  let token: string | undefined;
  let rest = "";
  const onLine = (line: string) => {
    let msg: JsonRpcMessage & { token?: unknown };
    try {
      msg = JSON.parse(line) as JsonRpcMessage & { token?: unknown };
    } catch {
      socket.write(errorLine(PARSE_ERROR, "parse error"));
      return;
    }
    if (token === undefined) {
      token = typeof msg.token === "string" ? msg.token : "";
      // A notification checks the token; it gets no answer and does nothing in the core.
      try {
        handle(token, { jsonrpc: "2.0", method: "notifications/hello" });
      } catch {
        socket.end(errorLine(UNKNOWN_TOKEN, "unknown task token"));
      }
      return;
    }
    try {
      const answer = handle(token, msg);
      if (answer !== undefined) socket.write(`${JSON.stringify(answer)}\n`);
    } catch (error) {
      if (error instanceof UnknownTokenError) {
        socket.end(errorLine(UNKNOWN_TOKEN, "unknown task token", msg.id ?? null));
      } else {
        socket.write(errorLine(INTERNAL_ERROR, (error as Error).message, msg.id ?? null));
      }
    }
  };
  socket.on("data", (chunk: Buffer) => {
    rest += chunk.toString("utf8");
    let nl = rest.indexOf("\n");
    while (nl >= 0) {
      const line = rest.slice(0, nl).trim();
      rest = rest.slice(nl + 1);
      if (line !== "" && !socket.destroyed) onLine(line);
      nl = rest.indexOf("\n");
    }
  });
}

export async function serveMcp(path: string, handle: McpHandler): Promise<McpServer> {
  const windows = path.startsWith("\\\\.\\pipe\\");
  if (!windows) {
    const dir = join(path, "..");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    if (existsSync(path)) unlinkSync(path);
  }
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
    serveSocket(socket, handle);
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(path, () => done());
  });
  if (!windows) chmodSync(path, 0o600);
  return {
    path,
    close: () =>
      new Promise<void>((done) => {
        for (const s of sockets) s.destroy();
        server.close(() => done());
      }),
  };
}
