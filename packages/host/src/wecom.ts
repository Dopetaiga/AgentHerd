// An application connection only: task agents use the existing approvals gateway.
import { createHash } from "node:crypto";
import type { AppToolInfo, AppTools, SecretStore } from "@agentherd/core";
import type { WecomConnectionView, WecomView } from "./api.ts";
import {
  httpClient,
  type McpClient,
  McpSessionExpiredError,
  type PluginTool,
} from "./plugin-mcp.ts";

const ACCOUNT = "wecom:mcp";
const TOOLKIT = "builtin:wecom";
const MAX_CONNECTIONS = 32;
const DISCOVERY_TIMEOUT_MS = 30_000;
const BAD_CONFIG = "请粘贴官方企业微信 MCP URL 或 Streamable HTTP JSON 配置。";
const CALL_FAILED = "企业微信工具调用失败，请检查连接和授权。";
const UNAVAILABLE = "企业微信工具不可用，请重新检查连接。";

interface Connection {
  id: string;
  url: string;
}

interface RemoteTool {
  tool: PluginTool;
  client: McpClient;
  url: string;
  readOnly: boolean;
  chatList: boolean;
}

interface Run {
  client: McpClient;
  done: Promise<void>;
  state: WecomConnectionView["state"];
  tools: Map<string, RemoteTool>;
}

const labels = new Map([
  ["doc", "文档"],
  ["docs", "文档"],
  ["sheet", "表格"],
  ["smartsheet", "智能表格"],
  ["smartpage", "智能文档"],
  ["pptx", "演示文稿"],
  ["message", "消息"],
  ["messages", "消息"],
  ["msg", "消息"],
  ["chat", "消息"],
  ["mail", "邮件"],
  ["email", "邮件"],
  ["todo", "待办"],
  ["calendar", "日程"],
  ["schedule", "日程"],
  ["meeting", "会议"],
  ["drive", "微盘"],
  ["disk", "微盘"],
  ["wedrive", "微盘"],
  ["wedisk", "微盘"],
  ["media", "媒体文件"],
  ["contact", "通讯录"],
  ["contacts", "通讯录"],
  ["identity", "用户信息"],
  ["user", "用户信息"],
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function endpoint(value: unknown): Connection {
  if (typeof value !== "string" || value.length > 8192) throw new Error(BAD_CONFIG);
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(BAD_CONFIG);
  }
  const id = /^\/mcp\/v\d+\/bot\/([a-z][a-z0-9_-]{0,39})\/?$/i
    .exec(url.pathname)?.[1]
    ?.toLowerCase();
  if (
    url.origin !== "https://qyapi.weixin.qq.com" ||
    url.username ||
    url.password ||
    url.hash ||
    !url.search ||
    id === undefined ||
    !labels.has(id)
  ) {
    throw new Error(BAD_CONFIG);
  }
  return { id, url: url.href };
}

function parse(input: string): Connection[] {
  if (typeof input !== "string" || input.length > 128 * 1024) throw new Error(BAD_CONFIG);
  if (!input.trimStart().startsWith("{")) return [endpoint(input)];
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error(BAD_CONFIG);
  }
  const servers = record(record(value)?.mcpServers);
  if (!servers) throw new Error(BAD_CONFIG);
  const entries = Object.values(servers);
  if (!entries.length || entries.length > MAX_CONNECTIONS) throw new Error(BAD_CONFIG);
  const connections = entries.map((item) => {
    const spec = record(item);
    if (
      !spec ||
      (spec.type !== undefined && spec.type !== "streamable-http") ||
      spec.command !== undefined ||
      spec.headers !== undefined
    ) {
      throw new Error(BAD_CONFIG);
    }
    return endpoint(spec.url);
  });
  if (new Set(connections.map(({ id }) => id)).size !== connections.length)
    throw new Error(BAD_CONFIG);
  return connections;
}

const nameOf = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
const CHAT =
  /(?:^|_)(?:chats?|sessions?|conversations?|aibot|messages?|msgs?|archives?|chatlogs?)(?:_|$)/;
const EXCLUDED_CHAT =
  /会话存档|聊天记录|聊天历史|历史(?:聊天|群聊|单聊|会话|消息)|(?:聊天|群聊|单聊|会话)历史|(?:接收|监听|订阅)(?:聊天|群聊|单聊|会话|消息)|\bchat\s*logs?\b|\b(?:chat|conversation|message)\s+(?:history|archives?|transcripts?|logs?)\b|\bincoming\s+(?:(?:chat|conversation)\s+)?(?:messages?|events?)\b/i;
const CHAT_LIST =
  /^(?:(?:wecom|message|aibot)_)*(?:sessions?_list|list_(?:(?:recent|aibot)_)?(?:sessions?|chats?)|(?:get|query)_(?:aibot_)?recent_(?:sessions?|chats?))$/;
const CHAT_SEND = /^(?:(?:wecom|message|aibot)_)*send(?:_(?:msg|message|chat_message))?$/;
const CHAT_DOMAIN = /^(?:messages?|msgs?|chats?|aibot)$/;
const OFFICE_SUBJECTS: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [
    /^(?:docs?|sheet|smartsheet|smartpage|pptx)$/,
    /(?:^|_)(?:docs?|documents?|spreadsheets?|sheets?|worksheets?|smartsheet|smartpage|pptx|slides?)(?:_|$)/,
  ],
  [/^(?:mail|email)$/, /(?:^|_)(?:e?mails?|mailboxes?|inbox|attachments?|folders?)(?:_|$)/],
  [/^todo$/, /(?:^|_)(?:todos?|tasks?)(?:_|$)/],
  [
    /^(?:calendar|schedule)$/,
    /(?:^|_)(?:calendars?|schedules?|events?|freebusy|availability)(?:_|$)/,
  ],
  [/^meeting$/, /(?:^|_)(?:meetings?|minutes|recordings?)(?:_|$)/],
  [
    /^(?:drive|disk|wedrive|wedisk|media)$/,
    /(?:^|_)(?:drive|disk|wedrive|wedisk|spaces?|folders?|files?|media|attachments?)(?:_|$)/,
  ],
  [
    /^(?:contacts?|identity|user)$/,
    /(?:^|_)(?:contacts?|users?|userinfo|members?|departments?|identity|profile|whoami)(?:_|$)/,
  ],
];
const READ =
  /^(?:(?:wecom|ww|mcp|doc|sheet|mail|email|todo|calendar|schedule|meeting|drive|wedrive|contact|user|media)_)*(?:get|list|search|read|query|fetch|lookup|download|describe|whoami)(?:_|$)/;
const WRITE =
  /(?:^|_)(?:send|reply|forward|post|create|add|append|edit|update|set|delete|remove|upload|share|invite|cancel|complete|move|copy|rename|insert|reset|publish|finish|close|transfer|subscribe|unsubscribe|toggle|mark|modify|save|batch)(?:_|$)/;

function operation(tool: PluginTool, domain: string): boolean | undefined {
  const name = nameOf(tool.name);
  if (
    EXCLUDED_CHAT.test(name.replaceAll("_", " ")) ||
    EXCLUDED_CHAT.test(tool.description ?? "") ||
    EXCLUDED_CHAT.test(tool.annotations?.title ?? "")
  )
    return undefined;
  if (CHAT_DOMAIN.test(domain) || CHAT.test(name)) {
    if (!CHAT_LIST.test(name) && !CHAT_SEND.test(name)) {
      // Mail/meeting names can contain words such as "message" or "session" without being chat.
      // Only the official non-chat endpoint can host these domain-qualified operations.
      if (
        !(
          ((domain === "mail" || domain === "email") &&
            /(?:^|_)(?:mail|email)(?:_|$)/.test(name)) ||
          (domain === "meeting" && /(?:^|_)meeting(?:_|$)/.test(name))
        ) ||
        /(?:^|_)(?:chat|conversation|archive|aibot)(?:_|$)/.test(name) ||
        /^(?:messages?|msgs?|chats?|aibot)$/.test(domain)
      )
        return undefined;
    }
  }
  // A multipurpose tool must not gain read access merely by using a read-sounding name.
  const schema = JSON.stringify(tool.inputSchema);
  const hasSelector = /"(?:action|operation|method|command|mode|workflow)"\s*:/i.test(schema);
  if (CHAT_LIST.test(name)) return hasSelector ? undefined : !tool.annotations?.destructiveHint;
  if (CHAT_SEND.test(name)) return hasSelector ? undefined : false;
  if (!OFFICE_SUBJECTS.some(([family, subject]) => family.test(domain) && subject.test(name)))
    return undefined;
  return (
    tool.annotations?.readOnlyHint === true &&
    !tool.annotations.destructiveHint &&
    READ.test(name) &&
    !WRITE.test(name) &&
    !hasSelector
  );
}

// Conversation discovery is for routing, not for returning message previews or bodies.
function sessionMetadata(result: unknown): unknown {
  const reply = record(result);
  if (!reply || reply.isError === true) throw new Error(CALL_FAILED);
  let data = record(reply.structuredContent) ?? reply;
  if (!Array.isArray(data.sessions) && Array.isArray(reply.content)) {
    for (const block of reply.content) {
      const text = record(block)?.text;
      if (typeof text !== "string") continue;
      try {
        const parsed = record(JSON.parse(text));
        if (parsed && Array.isArray(parsed.sessions)) {
          data = parsed;
          break;
        }
      } catch {
        /* Do not return unexpected upstream text. */
      }
    }
  }
  if (!Array.isArray(data.sessions)) throw new Error(CALL_FAILED);
  const sessions = data.sessions.flatMap((item) => {
    const fields = record(item);
    if (!fields || typeof fields.chat_id !== "string") return [];
    return [
      Object.fromEntries(
        ["chat_id", "chat_name", "chat_type", "last_msg_time"]
          .filter((key) => typeof fields[key] === "string")
          .map((key) => [key, fields[key]]),
      ),
    ];
  });
  const sanitized = { sessions, sessions_count: sessions.length };
  return {
    content: [{ type: "text", text: JSON.stringify(sanitized) }],
    structuredContent: sanitized,
  };
}

function slug(domain: string, name: string): string {
  // Hash the remote name to keep aliases independent of listing order and stable after reconnect.
  const hash = createHash("sha256").update(`${domain}\0${name}`).digest("hex").slice(0, 10);
  const prefix = `WECom_${domain}_${nameOf(name)}`.slice(0, 53);
  return `${prefix}_${hash}`;
}

/** Remove connection credentials even if an upstream tool echoes them in a result or schema. */
function scrub(value: unknown, endpointUrl: string): unknown {
  const url = new URL(endpointUrl);
  const sensitive = new Set([endpointUrl, url.search]);
  for (const [key, part] of url.searchParams) {
    if (part.length >= 8 || /token|secret|key|code|auth/i.test(key)) {
      if (part) {
        sensitive.add(part);
        sensitive.add(encodeURIComponent(part));
      }
    }
  }
  const redact = (text: string) => {
    for (const part of sensitive) text = text.replaceAll(part, "[redacted]");
    return text;
  };
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return redact(item);
    if (Array.isArray(item)) return item.map(walk);
    const obj = record(item);
    return obj === undefined
      ? item
      : Object.fromEntries(Object.entries(obj).map(([key, val]) => [redact(key), walk(val)]));
  };
  return walk(value);
}

export class Wecom {
  private connections = new Map<string, Connection>();
  private readonly runs = new Map<string, Run>();
  private readonly secrets: SecretStore;
  private readonly client: (url: string) => McpClient;

  constructor(
    secrets: SecretStore,
    client: (url: string) => McpClient = (url) =>
      httpClient({ url, headers: {}, redirect: "error", strictProtocol: true }),
  ) {
    this.secrets = secrets;
    this.client = client;
    const saved = this.secrets.get(ACCOUNT);
    if (!saved) return;
    try {
      const entries: unknown = JSON.parse(saved);
      if (!Array.isArray(entries) || entries.length > MAX_CONNECTIONS) return;
      for (const connection of entries.map(endpoint))
        this.connections.set(connection.id, connection);
    } catch {
      /* Invalid stored data stays disconnected. */
    }
  }

  private save(next: Map<string, Connection>): void {
    try {
      if (next.size)
        this.secrets.set(ACCOUNT, JSON.stringify([...next.values()].map(({ url }) => url)));
      else this.secrets.delete(ACCOUNT);
    } catch {
      throw new Error("无法保存企业微信凭据，请检查本地密钥存储。");
    }
    this.connections = next;
  }

  private stop(id: string): void {
    this.runs.get(id)?.client.close();
    this.runs.delete(id);
  }

  close(): void {
    for (const id of this.runs.keys()) this.stop(id);
  }

  view(): WecomView {
    return {
      connections: [...this.connections.values()].map(({ id }) => {
        const run = this.runs.get(id);
        return {
          id,
          name: labels.get(id) ?? `企业微信 (${id})`,
          state: run?.state ?? "idle",
          toolCount: run?.tools.size ?? 0,
        };
      }),
    };
  }

  async configure(input: string): Promise<WecomView> {
    const imported = parse(input);
    const next = new Map(this.connections);
    for (const connection of imported) next.set(connection.id, connection);
    if (next.size > MAX_CONNECTIONS) throw new Error(BAD_CONFIG);
    this.save(next);
    for (const { id } of imported) this.stop(id);
    await Promise.all(imported.map((connection) => this.start(connection)));
    return this.view();
  }

  async check(): Promise<WecomView> {
    this.close();
    await Promise.all([...this.connections.values()].map((connection) => this.start(connection)));
    return this.view();
  }

  remove(id: string): WecomView {
    if (!this.connections.has(id)) return this.view();
    const next = new Map(this.connections);
    next.delete(id);
    this.save(next);
    this.stop(id);
    return this.view();
  }

  private async start({ id, url }: Connection): Promise<void> {
    const current = this.runs.get(id);
    if (current) return current.done;
    const client = this.client(url);
    const run: Run = { client, state: "idle", tools: new Map(), done: Promise.resolve() };
    this.runs.set(id, run);
    run.done = Promise.resolve().then(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("WeCom tool discovery timed out")),
            DISCOVERY_TIMEOUT_MS,
          );
        });
        for (const tool of await Promise.race([client.tools(), deadline])) {
          if (scrub(tool.name, url) !== tool.name) continue;
          const readOnly = operation(tool, id);
          if (readOnly !== undefined)
            run.tools.set(slug(id, tool.name), {
              tool,
              client,
              url,
              readOnly,
              chatList:
                (CHAT_DOMAIN.test(id) || CHAT.test(nameOf(tool.name))) &&
                CHAT_LIST.test(nameOf(tool.name)),
            });
        }
        run.state = "ready";
      } catch {
        run.tools.clear();
        run.state = "failed";
        client.close();
      } finally {
        clearTimeout(timer);
      }
    });
    await run.done;
  }

  apps(): AppTools | undefined {
    if (!this.connections.size) return undefined;
    let snapshot: Promise<Map<string, RemoteTool>> | undefined;
    const tools = () => (snapshot ??= this.discover());
    return {
      list: async () =>
        [...(await tools())].map(([name, { tool, url }]) => ({
          name,
          description: scrub(tool.description, url) as string | undefined,
          inputSchema: scrub(tool.inputSchema, url) as PluginTool["inputSchema"],
        })),
      describe: async (names) => {
        const all = await tools();
        const descriptions = new Map<string, AppToolInfo>();
        for (const name of names) {
          const remote = all.get(name);
          if (!remote) continue;
          descriptions.set(name, {
            title: `企业微信: ${scrub(remote.tool.annotations?.title ?? remote.tool.name, remote.url) as string}`,
            toolkit: TOOLKIT,
            hints: {
              readOnly: remote.readOnly,
              create: !remote.readOnly,
              update: false,
              destructive: remote.tool.annotations?.destructiveHint === true,
            },
          });
        }
        return descriptions;
      },
      call: async (name, args) => {
        const remote = (await tools()).get(name);
        if (!remote || ![...this.runs.values()].some((run) => run.tools.get(name) === remote))
          throw new Error(UNAVAILABLE);
        try {
          const result = await remote.client.call(remote.tool.name, args);
          return scrub(remote.chatList ? sessionMetadata(result) : result, remote.url);
        } catch (error) {
          if (error instanceof McpSessionExpiredError) {
            for (const [id, run] of this.runs) {
              if (run.client === remote.client) this.stop(id);
            }
          }
          throw new Error(CALL_FAILED);
        }
      },
    };
  }

  private async discover(): Promise<Map<string, RemoteTool>> {
    await Promise.all([...this.connections.values()].map((connection) => this.start(connection)));
    return new Map([...this.runs.values()].flatMap((run) => [...run.tools]));
  }
}
