import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpGateway } from "@agentherd/core";
import { afterEach, describe, expect, it } from "vitest";
import { type McpServer, mcpServerFor, mcpSocketPath, serveMcp } from "../src/mcp-socket.ts";

let servers: McpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

async function setup() {
  const home = mkdtempSync(join(tmpdir(), "agentherd-mcpsock-"));
  const gateway = new McpGateway(() => {});
  const token = gateway.register("task-1");
  const server = await serveMcp(mcpSocketPath(home), (t, msg) => gateway.handle(t, msg));
  servers.push(server);
  return { server, token };
}

/** Sends lines on a raw socket and collects the answer lines until the socket closes or n lines. */
function talk(path: string, lines: string[], n: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const got: unknown[] = [];
    let rest = "";
    socket.on("connect", () => {
      for (const l of lines) socket.write(`${l}\n`);
    });
    socket.on("data", (chunk) => {
      rest += chunk.toString("utf8");
      let nl = rest.indexOf("\n");
      while (nl >= 0) {
        got.push(JSON.parse(rest.slice(0, nl)));
        rest = rest.slice(nl + 1);
        nl = rest.indexOf("\n");
      }
      if (got.length >= n) {
        socket.destroy();
        resolve(got);
      }
    });
    socket.on("close", () => resolve(got));
    socket.on("error", reject);
  });
}

describe("mcpSocketPath", () => {
  it("is a named pipe on Windows and a socket file elsewhere", () => {
    expect(mcpSocketPath("C:\\Users\\me\\.agentherd", "win32")).toMatch(
      /^\\\\\.\\pipe\\agentherd-mcp-[0-9a-f]{16}$/,
    );
    expect(mcpSocketPath("/home/me/.agentherd", "linux")).toBe(
      join("/home/me/.agentherd", "run", "mcp.sock"),
    );
  });
});

describe("serveMcp", () => {
  it("answers JSON-RPC lines after a good token", async () => {
    const { server, token } = await setup();
    const [pong] = await talk(
      server.path,
      [JSON.stringify({ token }), JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" })],
      1,
    );
    expect(pong).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
  });

  it("refuses a bad token with -32001 and closes", async () => {
    const { server } = await setup();
    const got = await talk(server.path, [JSON.stringify({ token: "nope" })], 1);
    expect(got[0]).toMatchObject({ error: { code: -32001 } });
  });

  it("answers bad JSON with -32700", async () => {
    const { server, token } = await setup();
    const [bad] = await talk(server.path, [JSON.stringify({ token }), "{not json"], 1);
    expect(bad).toMatchObject({ id: null, error: { code: -32700 } });
  });
});

describe("agentherd-mcp relay", () => {
  it("carries stdio JSON-RPC to the gateway and back", async () => {
    const { server, token } = await setup();
    const def = mcpServerFor(server.path, token);
    const env = { ...process.env, ...Object.fromEntries(def.env.map((e) => [e.name, e.value])) };
    const child = spawn(def.command, def.args, { env, stdio: ["pipe", "pipe", "inherit"] });
    const answer = new Promise<unknown>((resolve) => {
      let rest = "";
      child.stdout.on("data", (chunk: Buffer) => {
        rest += chunk.toString("utf8");
        const nl = rest.indexOf("\n");
        if (nl >= 0) resolve(JSON.parse(rest.slice(0, nl)));
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    const list = (await answer) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(["herd_report"]);
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    child.stdin.end();
    expect(await exited).toBe(0);
  });

  it("exits 2 without its environment", async () => {
    const def = mcpServerFor("unused", "unused");
    const child = spawn(def.command, def.args, {
      env: { ...process.env, AGENTHERD_MCP_SOCKET: "", AGENTHERD_MCP_TOKEN: "" },
      stdio: "ignore",
    });
    expect(await new Promise((resolve) => child.on("exit", resolve))).toBe(2);
  });
});
