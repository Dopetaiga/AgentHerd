// Talking to a plugin's MCP server (ADR 0094): a local program over stdio (newline-delimited
// JSON-RPC) or a server over Streamable HTTP. One client per server; it starts on first use,
// says initialize once, and lists or calls tools.

import { type ChildProcess, spawn } from "node:child_process";
import { killTree } from "@agentherd/acp-client";
import type { McpTool } from "@agentherd/core";

export const MCP_PROTOCOL = "2025-06-18";
/** Starting may download the server first (npx, uvx): give it time. */
export const MCP_START_MS = 120_000;
export const MCP_CALL_MS = 120_000;
const STDERR_KEEP = 2000;

/** An MCP tool with the hints the server gave (MCP tool annotations). */
export interface PluginTool extends McpTool {
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface McpClient {
  tools(): Promise<PluginTool[]>;
  call(name: string, args: unknown): Promise<unknown>;
  close(): void;
}

interface Pending {
  resolve(v: unknown): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const CLIENT_INFO = { name: "AgentHerd", version: "1" };

/** A local MCP server: one process, JSON-RPC lines on stdin and stdout. */
export function stdioClient(opts: {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  spawnFn?: typeof spawn;
}): McpClient {
  let child: ChildProcess | undefined;
  let ready: Promise<void> | undefined;
  let next = 1;
  let stderr = "";
  let ended: Error | undefined;
  const pending = new Map<number, Pending>();

  const fail = (error: Error) => {
    ended = error;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
  };

  const start = () => {
    const run = opts.spawnFn ?? spawn;
    const proc = run(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // npx, uvx and friends are .cmd files on Windows.
      shell: process.platform === "win32",
    });
    child = proc;
    ended = undefined;
    let buffer = "";
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let at = buffer.indexOf("\n");
      while (at >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        at = buffer.indexOf("\n");
        if (line === "") continue;
        let msg: { id?: unknown; result?: unknown; error?: { message?: string } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof msg.id !== "number") continue;
        const p = pending.get(msg.id);
        if (p === undefined) continue;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error !== undefined) p.reject(new Error(msg.error.message ?? "the server refused"));
        else p.resolve(msg.result);
      }
    });
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_KEEP);
    });
    proc.on("error", (error) => fail(new Error(`没能启动 ${opts.command}：${error.message}`)));
    proc.on("exit", (code) => {
      const tail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
      fail(
        new Error(`${opts.command} 退出了（${code ?? "被结束"}）${tail === "" ? "" : `：${tail}`}`),
      );
      if (child === proc) {
        child = undefined;
        ready = undefined;
      }
    });
  };

  const send = (method: string, params: unknown, ms: number): Promise<unknown> => {
    if (child === undefined || ended !== undefined) {
      return Promise.reject(ended ?? new Error("the server is not running"));
    }
    const id = next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} 没有在 ${Math.round(ms / 1000)} 秒内回答`));
      }, ms);
      pending.set(id, { resolve, reject, timer });
      child?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };

  const ensure = (): Promise<void> => {
    if (ready === undefined || ended !== undefined) {
      start();
      ready = send(
        "initialize",
        { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: CLIENT_INFO },
        MCP_START_MS,
      ).then(() => {
        child?.stdin?.write(
          `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
        );
      });
      ready.catch(() => {
        ready = undefined;
      });
    }
    return ready;
  };

  return {
    async tools() {
      await ensure();
      const r = (await send("tools/list", {}, MCP_CALL_MS)) as { tools?: PluginTool[] };
      return r.tools ?? [];
    },
    async call(name, args) {
      await ensure();
      return send("tools/call", { name, arguments: args ?? {} }, MCP_CALL_MS);
    },
    close() {
      const c = child;
      child = undefined;
      ready = undefined;
      fail(new Error("the server was stopped"));
      if (c !== undefined) killTree(c, "SIGTERM");
    },
  };
}

/** The reply with `id` from a JSON body or an event-stream body. */
export function replyFrom(
  contentType: string,
  text: string,
  id: number,
):
  | {
      result?: unknown;
      error?: { message?: string };
    }
  | undefined {
  const bodies = contentType.includes("text/event-stream")
    ? text
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
    : [text];
  for (const body of bodies) {
    let v: unknown;
    try {
      v = JSON.parse(body);
    } catch {
      continue;
    }
    for (const msg of Array.isArray(v) ? v : [v]) {
      if (msg !== null && typeof msg === "object" && (msg as { id?: unknown }).id === id) {
        return msg as { result?: unknown; error?: { message?: string } };
      }
    }
  }
  return undefined;
}

/** A remote MCP server over Streamable HTTP. */
export function httpClient(opts: {
  url: string;
  headers: Record<string, string>;
  fetchFn?: typeof fetch;
}): McpClient {
  const fetchFn = opts.fetchFn ?? fetch;
  let session: string | undefined;
  let ready: Promise<void> | undefined;
  let next = 1;

  const post = async (body: unknown, ms: number): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchFn(opts.url, {
        method: "POST",
        headers: {
          ...opts.headers,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": MCP_PROTOCOL,
          ...(session === undefined ? {} : { "mcp-session-id": session }),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ms),
      });
    } catch (error) {
      throw new Error(`连不上 ${new URL(opts.url).host}：${(error as Error).message}`);
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid !== null && sid !== "") session = sid;
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `${new URL(opts.url).host} 要先登录（${res.status}）：检查 Key；要在网页里授权（OAuth）的服务，AgentHerd 现在还不支持`,
      );
    }
    if (!res.ok) throw new Error(`${new URL(opts.url).host} 回答 HTTP ${res.status}`);
    return res;
  };

  const rpc = async (method: string, params: unknown, ms: number): Promise<unknown> => {
    const id = next++;
    const res = await post({ jsonrpc: "2.0", id, method, params }, ms);
    const reply = replyFrom(res.headers.get("content-type") ?? "", await res.text(), id);
    if (reply === undefined) throw new Error(`${new URL(opts.url).host} 没有回答 ${method}`);
    if (reply.error !== undefined) throw new Error(reply.error.message ?? "the server refused");
    return reply.result;
  };

  const ensure = (): Promise<void> => {
    if (ready === undefined) {
      ready = rpc(
        "initialize",
        { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: CLIENT_INFO },
        MCP_START_MS,
      ).then(async () => {
        await post({ jsonrpc: "2.0", method: "notifications/initialized" }, MCP_CALL_MS).catch(
          () => undefined,
        );
      });
      ready.catch(() => {
        ready = undefined;
      });
    }
    return ready;
  };

  return {
    async tools() {
      await ensure();
      const r = (await rpc("tools/list", {}, MCP_CALL_MS)) as { tools?: PluginTool[] };
      return r.tools ?? [];
    },
    async call(name, args) {
      await ensure();
      return rpc("tools/call", { name, arguments: args ?? {} }, MCP_CALL_MS);
    },
    close() {
      ready = undefined;
      session = undefined;
    },
  };
}
