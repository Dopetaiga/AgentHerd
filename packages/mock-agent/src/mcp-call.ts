// A minimal stdio MCP client for the `mcp_call` step: start the server, initialize, call one tool,
// stop. Enough to test the `agentherd` server end to end like a real agent would use it.

import { spawn } from "node:child_process";

export interface StdioServer {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
}

/** The tool result's text, or `error: …` when the server answered with an error. */
export function callTool(server: StdioServer, tool: string, args: unknown): Promise<string> {
  const env = { ...process.env, ...Object.fromEntries(server.env.map((e) => [e.name, e.value])) };
  const child = spawn(server.command, server.args, { env, stdio: ["pipe", "pipe", "inherit"] });
  const send = (msg: unknown) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  return new Promise<string>((resolve, reject) => {
    let rest = "";
    const done = (text: string) => {
      child.stdin.end();
      resolve(text);
    };
    child.on("error", reject);
    child.on("exit", (code) => done(`error: server exited (${code})`));
    child.stdout.on("data", (chunk: Buffer) => {
      rest += chunk.toString("utf8");
      let nl = rest.indexOf("\n");
      while (nl >= 0) {
        const msg = JSON.parse(rest.slice(0, nl)) as {
          id?: number | null;
          result?: { content?: { text?: string }[]; isError?: boolean };
          error?: { message: string };
        };
        rest = rest.slice(nl + 1);
        nl = rest.indexOf("\n");
        if (msg.error !== undefined) return done(`error: ${msg.error.message}`);
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: tool, arguments: args },
          });
        } else if (msg.id === 2) {
          const text = (msg.result?.content ?? []).map((c) => c.text ?? "").join("");
          return done(msg.result?.isError === true ? `error: ${text}` : text);
        }
      }
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "mock-agent", version: "0" },
      },
    });
  });
}
