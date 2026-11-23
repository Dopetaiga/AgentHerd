import { describe, expect, it, vi } from "vitest";
import { httpClient, type PluginTool } from "../src/plugin-mcp.ts";
import { Wecom } from "../src/wecom.ts";

const base = "https://qyapi.weixin.qq.com/mcp/v2/bot/";
const doc = `${base}doc?token=fake-doc`;
const chat = `${base}message?token=fake-message`;
const tool = (name: string, annotations?: PluginTool["annotations"]): PluginTool => ({
  name,
  inputSchema: { type: "object" },
  ...(annotations === undefined ? {} : { annotations }),
});

function fixture() {
  const values = new Map<string, string>();
  const secrets = {
    get: (key: string) => values.get(key),
    set: (key: string, value: string) => {
      values.set(key, value);
    },
    delete: (key: string) => {
      values.delete(key);
    },
  };
  const call = vi.fn(async (name: string) => ({ name }));
  const close = vi.fn();
  const client = vi.fn((url: string) => ({
    close,
    call,
    tools: async () => {
      if (url.includes("fake-failure")) throw new Error(`Cannot connect to ${url}`);
      if (url === chat)
        return [
          tool("aibot_sessions_list", { readOnlyHint: true }),
          tool("aibot_send_msg", { readOnlyHint: true }),
          tool("get_chat_history", { readOnlyHint: true }),
          tool("fetch_conversation", { readOnlyHint: true }),
        ];
      return [
        tool("read_document", { readOnlyHint: true }),
        tool("read_conversation_messages", { readOnlyHint: true }),
        { ...tool("fetch_transcript", { readOnlyHint: true }), description: "读取群聊历史消息" },
        { ...tool("activate_listener"), description: "Subscribe to incoming chat events" },
        tool("get_chatlog", { readOnlyHint: true }),
        tool("update_document", { readOnlyHint: true, destructiveHint: true }),
        tool("upload_document_attachment"),
        tool(`get_document_${new URL(url).searchParams.get("token")}`),
        tool("get_transcript", { readOnlyHint: true }),
        {
          ...tool("get_document_options", { readOnlyHint: true }),
          inputSchema: { type: "object", properties: { action: { type: "string" } } },
        },
      ];
    },
  }));
  return { values, secrets, call, close, client, wecom: new Wecom(secrets, client) };
}

function config(entries: Record<string, string>) {
  return JSON.stringify({
    mcpServers: Object.fromEntries(
      Object.entries(entries).map(([name, url]) => [name, { type: "streamable-http", url }]),
    ),
  });
}

describe("WeCom application connection", () => {
  it("imports official URLs/JSON into the secret store without exposing credentials and isolates failures", async () => {
    const { wecom, values, client, secrets } = fixture();
    const bad = `${base}meeting?token=fake-failure`;
    const view = await wecom.configure(config({ 企业微信文档: doc, 企业微信会议: bad }));
    expect(view.connections.map(({ state, toolCount }) => [state, toolCount])).toEqual([
      ["ready", 4],
      ["failed", 0],
    ]);
    expect(JSON.stringify(view)).not.toMatch(/fake-|qyapi/);
    expect([...values.values()].join()).toContain("fake-doc");
    expect(client).toHaveBeenCalledWith(doc);
    const restored = new Wecom(secrets, client);
    expect(restored.view().connections[0]?.state).toBe("idle");
    expect((await restored.check()).connections[0]?.state).toBe("ready");
    await wecom.configure(`${base}doc?token=fake-rotated`);
    expect(wecom.view().connections).toHaveLength(2);
    expect([...values.values()].join()).not.toContain("fake-doc");
    wecom.remove("doc");
    expect(wecom.view().connections.map((c) => c.id)).toEqual(["meeting"]);
  });

  it("drops old task snapshots after session expiry and discovers permissions again", async () => {
    const { secrets } = fixture();
    let generation = 0;
    const call = vi.fn(async () => ({ content: [] }));
    const fetchFn: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const reply = (result: unknown, headers?: Record<string, string>) =>
        Response.json({ jsonrpc: "2.0", id: request.id, result }, { headers });
      if (request.method === "initialize")
        return reply({ protocolVersion: "2025-06-18" }, { "mcp-session-id": `s${++generation}` });
      if (request.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      if (request.method === "tools/list")
        return reply({ tools: [tool("get_document", { readOnlyHint: generation === 1 })] });
      if (request.method === "tools/call") {
        await call();
        return generation === 1 ? new Response(null, { status: 404 }) : reply({ content: [] });
      }
      throw new Error("Unexpected MCP request");
    };
    const wecom = new Wecom(secrets, (url) =>
      httpClient({ url, headers: {}, strictProtocol: true, fetchFn }),
    );
    await wecom.configure(doc);
    const oldTask = wecom.apps();
    const name = (await oldTask?.list())?.[0]?.name;
    if (!oldTask || !name) throw new Error("Expected WeCom tool");
    expect((await oldTask.describe([name])).get(name)?.hints?.readOnly).toBe(true);
    await expect(oldTask.call(name, {})).rejects.toThrow("企业微信");
    await expect(oldTask.call(name, {})).rejects.toThrow("企业微信");
    expect(call).toHaveBeenCalledTimes(1);
    const newTask = wecom.apps();
    expect((await newTask?.describe([name]))?.get(name)?.hints?.readOnly).toBe(false);
    expect(generation).toBe(2);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("bounds discovery so a slow capability cannot hold the healthy tools indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const { secrets } = fixture();
      const close = vi.fn();
      const wecom = new Wecom(secrets, (url) => ({
        close,
        call: vi.fn(),
        tools: () =>
          url === doc ? Promise.resolve([tool("read_document")]) : new Promise(() => {}),
      }));
      const configuring = wecom.configure(
        config({ docs: doc, meetings: `${base}meeting?token=fake-slow` }),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(wecom.view().connections.map(({ state }) => state)).toEqual(["ready", "failed"]);
      await configuring;
      expect(await wecom.apps()?.list()).toHaveLength(1);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unsafe or unsupported configurations before saving or connecting", async () => {
    const { wecom, client, values } = fixture();
    for (const input of [
      `http://qyapi.weixin.qq.com/mcp/v2/bot/doc?token=x`,
      `https://qyapi.weixin.qq.com.invalid/mcp/v2/bot/doc?token=x`,
      `https://me:password@qyapi.weixin.qq.com/mcp/v2/bot/doc?token=x`,
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpsecret=x`,
      `${base}doc`,
      `${base}chat_archive?token=x`,
      config({ valid: doc, invalid: "https://other.example/?token=x" }),
      JSON.stringify({ mcpServers: { bad: { command: "npx", url: doc } } }),
    ])
      await expect(wecom.configure(input)).rejects.toThrow("企业微信 MCP");
    expect(client).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
  });

  it("returns only routing metadata from an eligible chat listing", async () => {
    const { wecom, call } = fixture();
    const result = {
      sessions: [
        { chat_id: "cid", chat_name: "Group", last_msg_time: "now", last_message: "private" },
      ],
      sessions_count: 1,
    };
    call.mockResolvedValueOnce({
      name: "mock",
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    } as { name: string });
    await wecom.configure(chat);
    const apps = wecom.apps();
    if (!apps) throw new Error("Expected WeCom app tools");
    const list = (await apps.list()).find((t) => t.name.includes("sessions_list"));
    if (!list) throw new Error("Expected a session metadata tool");
    const reply = await apps.call(list.name, {});
    expect(JSON.stringify(reply)).toContain("chat_id");
    expect(JSON.stringify(reply)).toContain("Group");
    expect(JSON.stringify(reply)).not.toMatch(/private|last_message/);
  });

  it("exposes only safe chat operations, keeps unknown writes behind approval, and rejects stale tools", async () => {
    const { wecom, call } = fixture();
    await wecom.configure(config({ 文档: doc, 消息: chat }));
    const apps = wecom.apps();
    if (!apps) throw new Error("Expected WeCom app tools");
    const names = (await apps.list()).map((t) => t.name);
    expect(names).toHaveLength(6);
    expect(names.join(" ")).not.toMatch(
      /history|read_conversation_messages|fetch_conversation|transcript|fake_doc/,
    );
    const infos = await apps.describe(names);
    const named = (suffix: string) => {
      const name = names.find((n) => n.includes(suffix));
      if (!name) throw new Error(`Expected WeCom tool ${suffix}`);
      return name;
    };
    const read = named("read_document");
    const update = named("update_document");
    const send = named("send_msg");
    const upload = named("upload_document_attachment");
    const options = named("get_document_options");
    expect(infos.get(read)).toMatchObject({ toolkit: "builtin:wecom", hints: { readOnly: true } });
    for (const name of [update, send, upload, options]) {
      expect(infos.get(name)).toMatchObject({
        toolkit: "builtin:wecom",
        hints: { readOnly: false, create: true },
      });
    }
    await apps.call(read, {});
    expect(call).toHaveBeenCalledWith("read_document", {});
    wecom.remove("doc");
    await expect(apps.call(read, {})).rejects.toThrow("企业微信");
    expect(call).toHaveBeenCalledTimes(1);
  });
});
