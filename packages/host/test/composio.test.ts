import { describe, expect, it } from "vitest";
import {
  COMPOSIO_API,
  ComposioError,
  composioClient,
  hintsOf,
  mcpHttpClient,
} from "../src/composio.ts";

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function fakeFetch(
  answer: (req: Seen) => {
    status?: number;
    body?: unknown;
    headers?: Record<string, string | undefined>;
    text?: string | undefined;
  },
) {
  const seen: Seen[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    const req: Seen = {
      url,
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      ...(init.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
    };
    seen.push(req);
    const a = answer(req);
    const text = a.text ?? (a.body === undefined ? "" : JSON.stringify(a.body));
    return new Response(text === "" ? null : text, {
      status: a.status ?? 200,
      headers: {
        "content-type": "application/json",
        ...(Object.fromEntries(
          Object.entries(a.headers ?? {}).filter(([, v]) => v !== undefined),
        ) as Record<string, string>),
      },
    });
  }) as unknown as typeof fetch;
  return { fn, seen };
}

describe("composioClient", () => {
  it("sends the key on every request and reads a session", async () => {
    const { fn, seen } = fakeFetch(() => ({
      status: 201,
      body: { session_id: "s1", mcp: { type: "http", url: "https://mcp.example/s1" } },
    }));
    const c = composioClient("ck_secret_123", fn);
    expect(await c.createSession("agentherd-1", ["gmail"])).toEqual({
      id: "s1",
      mcpUrl: "https://mcp.example/s1",
    });
    expect(seen[0]).toMatchObject({
      url: `${COMPOSIO_API}/tool_router/session`,
      method: "POST",
      headers: { "x-api-key": "ck_secret_123" },
      body: {
        user_id: "agentherd-1",
        toolkits: { enable: ["gmail"] },
        manage_connections: { enable: false },
        workbench: { enable: false },
      },
    });
    await c.createSession("agentherd-1", []);
    expect(seen[1]?.body).not.toHaveProperty("toolkits");
  });

  it("turns a 401 into a ComposioError with the slug", async () => {
    const { fn } = fakeFetch(() => ({
      status: 401,
      body: {
        error: {
          message: "Invalid API key: inv**_123",
          code: 801,
          slug: "APIKey_InvalidAPIKey",
          status: 401,
        },
      },
    }));
    const err = await composioClient("bad", fn)
      .checkKey()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComposioError);
    expect(err).toMatchObject({
      status: 401,
      slug: "APIKey_InvalidAPIKey",
      message: "Invalid API key: inv**_123",
    });
  });

  it("follows pages of toolkits and reads connected accounts", async () => {
    const { fn, seen } = fakeFetch((req) =>
      req.url.includes("cursor=c2")
        ? {
            body: {
              items: [
                { slug: "github", name: "GitHub", is_no_auth: false, connected_account: null },
              ],
              next_cursor: null,
            },
          }
        : {
            body: {
              items: [
                {
                  slug: "gmail",
                  name: "Gmail",
                  meta: { logo: "https://logo/gmail.png" },
                  connected_account: { id: "ca_1", status: "ACTIVE" },
                },
              ],
              next_cursor: "c2",
            },
          },
    );
    const list = await composioClient("k", fn).toolkits("s 1", { search: "g" });
    expect(list).toEqual([
      {
        slug: "gmail",
        name: "Gmail",
        logo: "https://logo/gmail.png",
        noAuth: false,
        account: { id: "ca_1", status: "ACTIVE" },
      },
      { slug: "github", name: "GitHub", noAuth: false },
    ]);
    expect(seen[0]?.url).toBe(
      `${COMPOSIO_API}/tool_router/session/s%201/toolkits?limit=50&search=g`,
    );
  });

  it("links, polls, disconnects and reads a tool", async () => {
    const { fn, seen } = fakeFetch((req) => {
      if (req.url.endsWith("/link"))
        return {
          status: 201,
          body: { redirect_url: "https://auth/x", connected_account_id: "ca_9" },
        };
      if (req.url.endsWith("/connected_accounts/ca_9") && req.method === "GET") {
        return { body: { status: "ACTIVE", toolkit: { slug: "gmail" } } };
      }
      if (req.method === "DELETE") return { body: { success: true } };
      return {
        body: {
          slug: "GMAIL_SEND_EMAIL",
          name: "Send email",
          toolkit: { slug: "gmail", name: "Gmail" },
          tags: ["createHint", "openWorldHint"],
        },
      };
    });
    const c = composioClient("k", fn);
    expect(await c.link("s1", "gmail")).toEqual({ url: "https://auth/x", accountId: "ca_9" });
    expect(seen[0]?.body).toEqual({ toolkit: "gmail" });
    expect(await c.account("ca_9")).toEqual({ status: "ACTIVE", toolkit: "gmail" });
    await c.disconnect("ca_9");
    expect(seen[2]).toMatchObject({
      method: "DELETE",
      url: `${COMPOSIO_API}/connected_accounts/ca_9`,
    });
    expect(await c.tool("GMAIL_SEND_EMAIL")).toEqual({
      slug: "GMAIL_SEND_EMAIL",
      name: "Send email",
      toolkit: "gmail",
      toolkitName: "Gmail",
      tags: ["createHint", "openWorldHint"],
    });
  });

  it("reports a network failure as status 0", async () => {
    const fn = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(composioClient("k", fn).checkKey()).rejects.toMatchObject({ status: 0 });
  });
});

describe("hintsOf", () => {
  it("reads the hint tags and nothing else", () => {
    expect(hintsOf(["readOnlyHint", "important"])).toEqual({
      readOnly: true,
      create: false,
      update: false,
      destructive: false,
    });
    expect(hintsOf(["destructiveHint", "updateHint"])).toEqual({
      readOnly: false,
      create: false,
      update: true,
      destructive: true,
    });
    expect(hintsOf(["openWorldHint"])).toBeUndefined();
  });
});

describe("mcpHttpClient", () => {
  it("initializes once, keeps the session id, and reads JSON and SSE replies", async () => {
    const { fn, seen } = fakeFetch((req) => {
      const body = req.body as { id?: number; method: string };
      if (body.method === "initialize") {
        return {
          body: { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } },
          headers: { "mcp-session-id": "m-1" },
        };
      }
      if (body.method === "notifications/initialized") return { status: 202 };
      if (body.method === "tools/list") {
        return {
          body: {
            jsonrpc: "2.0",
            id: body.id,
            result: { tools: [{ name: "COMPOSIO_SEARCH_TOOLS", inputSchema: {} }] },
          },
        };
      }
      return {
        headers: { "content-type": "text/event-stream" },
        text: `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":${body.id},"result":{"content":[{"type":"text","text":"ok"}]}}\n\n`,
      };
    });
    const mcp = mcpHttpClient("https://mcp.example/s1", "k", fn);
    expect((await mcp.listTools()).map((t) => t.name)).toEqual(["COMPOSIO_SEARCH_TOOLS"]);
    expect(await mcp.callTool("COMPOSIO_SEARCH_TOOLS", { queries: [] })).toEqual({
      content: [{ type: "text", text: "ok" }],
    });
    expect(seen.map((s) => (s.body as { method: string }).method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ]);
    expect(seen[0]?.headers["mcp-session-id"]).toBeUndefined();
    expect(seen[3]?.headers).toMatchObject({ "mcp-session-id": "m-1", "x-api-key": "k" });
  });

  it("starts a new MCP session once when the old one is gone", async () => {
    let lists = 0;
    const { fn, seen } = fakeFetch((req) => {
      const body = req.body as { id?: number; method: string };
      if (body.method === "initialize")
        return {
          body: { jsonrpc: "2.0", id: body.id, result: {} },
          headers: { "mcp-session-id": `m-${seen.length}` },
        };
      if (body.method === "notifications/initialized") return { status: 202 };
      lists++;
      if (lists === 1) return { status: 404, text: "" };
      return { body: { jsonrpc: "2.0", id: body.id, result: { tools: [] } } };
    });
    expect(await mcpHttpClient("https://mcp.example/s1", "k", fn).listTools()).toEqual([]);
    expect(seen.filter((s) => (s.body as { method: string }).method === "initialize")).toHaveLength(
      2,
    );
  });
});
