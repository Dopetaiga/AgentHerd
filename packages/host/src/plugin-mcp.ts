// Talking to a plugin's MCP server (ADR 0094): a local program over stdio (newline-delimited
// JSON-RPC) or a server over Streamable HTTP. One client per server; it starts on first use,
// says initialize once, and lists or calls tools.

import { type ChildProcess, spawn } from "node:child_process";
import { killTree } from "@agentherd/acp-client";
import type { McpTool } from "@agentherd/core";

export const MCP_PROTOCOL = "2025-06-18";
const STREAMABLE_HTTP_VERSIONS = new Set([MCP_PROTOCOL, "2025-03-26"]);
const MAX_TOOL_PAGES = 32;
const MAX_STRICT_REPLY_BYTES = 4 * 1024 * 1024;
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

/** A strict remote tool snapshot must be discarded when its session expires. */
export class McpSessionExpiredError extends Error {
  constructor() {
    super("MCP session expired (HTTP 404)");
  }
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

interface RpcReply {
  result?: unknown;
  error?: { message?: string };
}

function jsonReply(text: string, id: number, strict = false): RpcReply | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  for (const msg of Array.isArray(value) ? value : [value]) {
    if (
      msg !== null &&
      typeof msg === "object" &&
      (msg as { id?: unknown }).id === id &&
      (!strict || (!("method" in msg) && ("result" in msg || "error" in msg)))
    ) {
      return msg as RpcReply;
    }
  }
  return undefined;
}

function isEventStream(contentType: string): boolean {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() === "text/event-stream";
}

/** Read complete SSE events, without requiring a line or a UTF-8 character per chunk. */
function eventReplies(id: number): (chunk: string) => RpcReply | undefined {
  let pendingLine = "";
  let afterCr = false;
  let data: string[] = [];
  return (chunk) => {
    if (chunk === "") return undefined;
    const lines = (afterCr && chunk.startsWith("\n") ? chunk.slice(1) : chunk).split(/\r\n|\r|\n/);
    afterCr = chunk.endsWith("\r");
    lines[0] = pendingLine + lines[0];
    pendingLine = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "" && data.length > 0) {
        const reply = jsonReply(data.join("\n"), id, true);
        data = [];
        if (reply !== undefined) return reply;
      } else if (line === "data" || line.startsWith("data:")) {
        const value = line.slice(5);
        data.push(value.startsWith(" ") ? value.slice(1) : value);
      }
    }
    return undefined;
  };
}

/** The reply with `id` from a JSON body or an event-stream body. */
export function replyFrom(contentType: string, text: string, id: number): RpcReply | undefined {
  // Generic plugins have historically sent one JSON reply per data line, even at EOF.
  if (!contentType.includes("text/event-stream")) return jsonReply(text, id);
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const reply = jsonReply(line.slice(5).trim(), id);
    if (reply !== undefined) return reply;
  }
  return undefined;
}

async function readStrictReply(res: Response, id: number): Promise<RpcReply | undefined> {
  if (res.body === null) return undefined;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const push = isEventStream(res.headers.get("content-type") ?? "") ? eventReplies(id) : undefined;
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        const tail = decoder.decode();
        return push === undefined ? jsonReply(text + tail, id, true) : push(tail);
      }
      bytes += value.byteLength;
      if (bytes > MAX_STRICT_REPLY_BYTES) throw new Error("MCP response exceeded the size limit");
      const chunk = decoder.decode(value, { stream: true });
      if (push === undefined) text += chunk;
      else {
        const reply = push(chunk);
        if (reply !== undefined) return reply;
      }
    }
  } finally {
    // A reply completes this POST even if the server keeps the stream open.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** A remote MCP server over Streamable HTTP. */
export function httpClient(opts: {
  url: string;
  headers: Record<string, string>;
  redirect?: RequestRedirect;
  /** Require a supported version and an accepted initialized notification before using tools. */
  strictProtocol?: boolean;
  fetchFn?: typeof fetch;
}): McpClient {
  const fetchFn = opts.fetchFn ?? fetch;
  let session: string | undefined;
  let negotiatedVersion: string | undefined;
  let ready: Promise<void> | undefined;
  let expired = false;
  let closed = false;
  let next = 1;

  const post = async (body: unknown, ms: number): Promise<Response> => {
    if (expired) throw new McpSessionExpiredError();
    if (closed) throw new Error("MCP client is closed");
    const version = opts.strictProtocol ? negotiatedVersion : MCP_PROTOCOL;
    const sentSession = session;
    let res: Response;
    try {
      res = await fetchFn(opts.url, {
        method: "POST",
        headers: {
          ...opts.headers,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(version === undefined ? {} : { "mcp-protocol-version": version }),
          ...(sentSession === undefined ? {} : { "mcp-session-id": sentSession }),
        },
        body: JSON.stringify(body),
        redirect: opts.redirect,
        signal: AbortSignal.timeout(ms),
      });
    } catch (error) {
      throw new Error(`连不上 ${new URL(opts.url).host}：${(error as Error).message}`);
    }
    if (opts.strictProtocol && res.status === 404 && sentSession !== undefined) {
      // Retire this client with its tool snapshot. Only a new client can discover
      // a replacement session; never initialize or replay a call under old hints.
      expired = true;
      void res.body?.cancel().catch(() => undefined);
      throw new McpSessionExpiredError();
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid !== null && sid !== "" && (!opts.strictProtocol || session === sentSession))
      session = sid;
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
    const reply = opts.strictProtocol
      ? await readStrictReply(res, id)
      : replyFrom(res.headers.get("content-type") ?? "", await res.text(), id);
    if (reply === undefined) throw new Error(`${new URL(opts.url).host} 没有回答 ${method}`);
    if (reply.error !== undefined) throw new Error(reply.error.message ?? "the server refused");
    return reply.result;
  };

  const ensure = (): Promise<void> => {
    if (ready === undefined) {
      const initializing = rpc(
        "initialize",
        { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: CLIENT_INFO },
        MCP_START_MS,
      ).then(async (result) => {
        const notification = { jsonrpc: "2.0", method: "notifications/initialized" };
        if (!opts.strictProtocol) {
          await post(notification, MCP_CALL_MS).catch(() => undefined);
          return;
        }
        const version = (result as { protocolVersion?: unknown } | null | undefined)
          ?.protocolVersion;
        if (typeof version !== "string" || !STREAMABLE_HTTP_VERSIONS.has(version)) {
          throw new Error("MCP protocol version is missing or unsupported");
        }
        negotiatedVersion = version;
        const res = await post(notification, MCP_CALL_MS);
        if (res.status !== 202) {
          void res.body?.cancel().catch(() => undefined);
          throw new Error(`notifications/initialized returned HTTP ${res.status}, expected 202`);
        }
      });
      ready = initializing;
      initializing.catch(() => {
        if (ready !== initializing) return;
        ready = undefined;
        if (opts.strictProtocol) {
          session = undefined;
          negotiatedVersion = undefined;
        }
      });
    }
    return ready;
  };

  return {
    async tools() {
      await ensure();
      if (!opts.strictProtocol) {
        const r = (await rpc("tools/list", {}, MCP_CALL_MS)) as { tools?: PluginTool[] };
        return r.tools ?? [];
      }
      const tools: PluginTool[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let count = 0; count < MAX_TOOL_PAGES; count++) {
        const params = cursor === undefined ? {} : { cursor };
        const page = (await rpc("tools/list", params, MCP_CALL_MS)) as {
          tools?: PluginTool[];
          nextCursor?: unknown;
        };
        for (const tool of page.tools ?? []) tools.push(tool);
        const nextCursor = page.nextCursor;
        if (nextCursor === undefined) return tools;
        if (typeof nextCursor !== "string")
          throw new Error("tools/list returned an invalid cursor");
        if (cursors.has(nextCursor)) throw new Error("tools/list returned a repeated cursor");
        cursors.add(nextCursor);
        cursor = nextCursor;
      }
      throw new Error("tools/list exceeded the page limit");
    },
    async call(name, args) {
      await ensure();
      return rpc("tools/call", { name, arguments: args ?? {} }, MCP_CALL_MS);
    },
    close() {
      closed = opts.strictProtocol === true;
      ready = undefined;
      session = undefined;
      negotiatedVersion = undefined;
    },
  };
}
