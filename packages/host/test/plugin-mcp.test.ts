import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { httpClient } from "../src/plugin-mcp.ts";

interface RpcRequest {
  jsonrpc: string;
  id?: number;
  method: string;
  params?: unknown;
}

const sessionId = "test-mcp-session";
const protocolVersion = "2025-06-18";
const initializeResult = {
  protocolVersion,
  capabilities: { tools: {} },
  serverInfo: { name: "test-server", version: "1" },
};

function jsonReply(id: number | undefined, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function fakeClient(
  handle: (request: RpcRequest) => Response,
  opts: {
    strictProtocol?: boolean;
    initialize?: unknown;
    initialized?: () => Response;
  } = {},
) {
  const requests: { request: RpcRequest; session: string | null; protocol: string | null }[] = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as RpcRequest;
    const headers = new Headers(init?.headers);
    requests.push({
      request,
      session: headers.get("mcp-session-id"),
      protocol: headers.get("mcp-protocol-version"),
    });
    if (request.method === "initialize") {
      return Response.json(
        { jsonrpc: "2.0", id: request.id, result: opts.initialize ?? initializeResult },
        { headers: { "mcp-session-id": sessionId } },
      );
    }
    if (request.method === "notifications/initialized") {
      return opts.initialized?.() ?? new Response(null, { status: 202 });
    }
    return handle(request);
  };
  const createClient = () =>
    httpClient({
      url: "https://mcp.example.test",
      headers: {},
      strictProtocol: opts.strictProtocol,
      fetchFn,
    });
  return { client: createClient(), createClient, requests };
}

function sse(chunks: Uint8Array[], onCancel?: () => void): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(stream) {
        for (const chunk of chunks) stream.enqueue(chunk);
        if (onCancel === undefined) stream.close();
      },
      cancel() {
        onCancel?.();
      },
    }),
    { headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

const readTool = {
  name: "read",
  inputSchema: { type: "object" },
  annotations: { readOnlyHint: true },
};
const writeTool = { name: "write", inputSchema: { type: "object" } };

describe("plugin MCP over Streamable HTTP", () => {
  it("follows opaque tools/list cursors in the initialized session", async () => {
    const { client, requests } = fakeClient(
      (request) => {
        if (request.method === "tools/call") return jsonReply(request.id, { content: [] });
        const cursor = (request.params as { cursor?: string }).cursor;
        if (cursor === undefined)
          return jsonReply(request.id, { tools: [readTool], nextCursor: " z/+== " });
        if (cursor === " z/+== ") return jsonReply(request.id, { tools: [], nextCursor: "" });
        if (cursor === "") return jsonReply(request.id, { tools: [writeTool] });
        throw new Error("unexpected cursor");
      },
      { strictProtocol: true },
    );

    const tools = await client.tools();
    expect(tools).toEqual([readTool, writeTool]);
    await expect(client.call("read", { page: 2 })).resolves.toEqual({ content: [] });

    expect(requests.map(({ request }) => request)).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: "AgentHerd", version: "1" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "tools/list", params: { cursor: " z/+== " } },
      { jsonrpc: "2.0", id: 4, method: "tools/list", params: { cursor: "" } },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "read", arguments: { page: 2 } },
      },
    ]);
    expect(requests.slice(1).map(({ session, protocol }) => [session, protocol])).toEqual(
      Array.from({ length: 5 }, () => [sessionId, protocolVersion]),
    );
    expect(requests[0]?.session).toBeNull();
  });

  it("uses the server's supported older version after initialization in strict mode", async () => {
    const { client, requests } = fakeClient(
      ({ method, id }) => jsonReply(id, method === "tools/list" ? { tools: [readTool] } : {}),
      { strictProtocol: true, initialize: { ...initializeResult, protocolVersion: "2025-03-26" } },
    );

    await expect(client.tools()).resolves.toEqual([readTool]);
    await client.call("read", {});

    expect(requests[0]?.request.params).toMatchObject({ protocolVersion: "2025-06-18" });
    expect(
      requests.map(({ request, protocol, session }) => [request.method, protocol, session]),
    ).toEqual([
      ["initialize", null, null],
      ["notifications/initialized", "2025-03-26", sessionId],
      ["tools/list", "2025-03-26", sessionId],
      ["tools/call", "2025-03-26", sessionId],
    ]);
  });

  it.each([
    ["unsupported", "2030-01-01"],
    ["missing", undefined],
    ["malformed", 20250326],
  ])(
    "rejects a protocol version that is %s before sending further requests in strict mode",
    async (_, version) => {
      const { client, requests } = fakeClient(({ id }) => jsonReply(id, { tools: [] }), {
        strictProtocol: true,
        initialize: { ...initializeResult, protocolVersion: version },
      });

      await expect(client.tools()).rejects.toThrow(/MCP protocol version/i);
      expect(requests.map(({ request }) => request.method)).toEqual(["initialize"]);
    },
  );

  it.each([400, 200])(
    "stops the strict handshake when initialized receives HTTP %s",
    async (status) => {
      const { client, requests } = fakeClient(({ id }) => jsonReply(id, { content: [] }), {
        strictProtocol: true,
        initialized: () => new Response(null, { status }),
      });

      await expect(client.call("read", {})).rejects.toThrow(`HTTP ${status}`);
      expect(requests.map(({ request }) => request.method)).toEqual([
        "initialize",
        "notifications/initialized",
      ]);
    },
  );

  it("requires a fresh strict client after its session expires during initialization", async () => {
    let notifications = 0;
    const { client, createClient, requests } = fakeClient(
      ({ id }) => jsonReply(id, { tools: [readTool] }),
      {
        strictProtocol: true,
        initialize: { ...initializeResult, protocolVersion: "2025-03-26" },
        initialized: () => new Response(null, { status: ++notifications === 1 ? 404 : 202 }),
      },
    );

    await expect(client.tools()).rejects.toThrow("HTTP 404");
    await expect(client.tools()).rejects.toThrow("HTTP 404");
    await expect(createClient().tools()).resolves.toEqual([readTool]);
    expect(
      requests
        .filter(({ request }) => request.method === "initialize")
        .map(({ protocol, session }) => [protocol, session]),
    ).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("retires an expired strict client without replaying the failed call", async () => {
    let calls = 0;
    const { client, createClient, requests } = fakeClient(
      ({ id }) => {
        if (++calls === 1) return new Response(null, { status: 404 });
        return jsonReply(id, { content: [] });
      },
      { strictProtocol: true },
    );

    await expect(client.call("write", {})).rejects.toThrow("HTTP 404");
    await expect(client.call("read", {})).rejects.toThrow("HTTP 404");
    expect(calls).toBe(1);
    await expect(createClient().call("read", {})).resolves.toEqual({ content: [] });
    expect(requests.map(({ request, session }) => [request.method, session])).toEqual([
      ["initialize", null],
      ["notifications/initialized", sessionId],
      ["tools/call", sessionId],
      ["initialize", null],
      ["notifications/initialized", sessionId],
      ["tools/call", sessionId],
    ]);
  });

  it("reads a generic plugin SSE reply with no terminal blank line", async () => {
    const { client } = fakeClient(({ id }) =>
      sse([new TextEncoder().encode(`data: {"jsonrpc":"2.0","id":${id},"result":{"content":[]}}`)]),
    );

    await expect(client.call("read", {})).resolves.toEqual({ content: [] });
  });

  it("discovers only the first tool page for generic plugins", async () => {
    const { client, requests } = fakeClient(({ id, params }) =>
      "cursor" in (params as object)
        ? jsonReply(id, { tools: [writeTool] })
        : jsonReply(id, { tools: [readTool], nextCursor: "second" }),
    );

    await expect(client.tools()).resolves.toEqual([readTool]);
    expect(requests.filter(({ request }) => request.method === "tools/list")).toHaveLength(1);
  });

  it("keeps the legacy handshake for generic plugins", async () => {
    const { client, requests } = fakeClient(({ id }) => jsonReply(id, { tools: [readTool] }), {
      initialize: { capabilities: {} },
      initialized: () => new Response(null, { status: 400 }),
    });

    await expect(client.tools()).resolves.toEqual([readTool]);
    expect(requests.map(({ protocol }) => protocol)).toEqual(Array(3).fill("2025-06-18"));
  });

  it("rejects repeated cursors rather than returning partial tools or looping", async () => {
    let pages = 0;
    const { client } = fakeClient(
      ({ id }) => {
        if (++pages > 2) throw new Error("too many tool pages requested");
        return jsonReply(id, { tools: [readTool], nextCursor: "same" });
      },
      { strictProtocol: true },
    );

    await expect(client.tools()).rejects.toThrow(/tools\/list.*cursor/i);
    expect(pages).toBe(2);
  });

  it("does not send a follow-up request with a non-string cursor", async () => {
    let pages = 0;
    const { client } = fakeClient(
      ({ id }) => {
        if (++pages > 1) throw new Error("an invalid cursor was sent");
        return jsonReply(id, { tools: [readTool], nextCursor: { page: 2 } });
      },
      { strictProtocol: true },
    );

    await expect(client.tools()).rejects.toThrow(/tools\/list.*invalid cursor/i);
    expect(pages).toBe(1);
  });

  it.each([32, 33])("bounds strict discovery when %i pages are offered", async (offered) => {
    let pages = 0;
    const { client } = fakeClient(
      ({ id, params }) => {
        expect(params).toEqual(pages === 0 ? {} : { cursor: `page-${pages + 1}` });
        pages++;
        return jsonReply(id, {
          tools: pages === offered ? [writeTool] : [],
          ...(pages === offered ? {} : { nextCursor: `page-${pages + 1}` }),
        });
      },
      { strictProtocol: true },
    );

    if (offered === 32) await expect(client.tools()).resolves.toEqual([writeTool]);
    else await expect(client.tools()).rejects.toThrow(/tools\/list.*page limit/i);
    expect(pages).toBe(32);
  });

  it("returns the matching SSE reply and cancels the still-open body", async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    let cancelled = false;
    const { client } = fakeClient(
      ({ id }) => {
        const prefix = encode(
          `: heartbeat\r\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n` +
            `data: {"jsonrpc":"2.0","id":99,"result":{"content":[]}}\n\n` +
            `data: {"jsonrpc":"2.0","id":${id},"method":"ping"}\n\n` +
            `event: message\r\nid: event-1\r\ndata: {"jsonrpc":"2.0",\r\n` +
            `data: "id":${id},"result":{"content":[{"type":"text","text":"`,
        );
        const suffix = encode('企业"}]}}\r\n\r');
        return sse([prefix, suffix.slice(0, 1), suffix.slice(1), encode("\n")], () => {
          cancelled = true;
        });
      },
      { strictProtocol: true },
    );

    await expect(client.call("read", {})).resolves.toEqual({
      content: [{ type: "text", text: "企业" }],
    });
    expect(cancelled).toBe(true);
  }, 1_000);

  it.each(["heartbeat events", "unfinished data"])(
    "rejects and cancels a strict SSE response with too many bytes of %s",
    async (kind) => {
      const enc = new TextEncoder();
      const text = "填".repeat(750_000);
      const chunk = enc.encode(kind === "heartbeat events" ? `: ${text}\n\n` : `data: ${text}`);
      let cancelled = false;
      const { client } = fakeClient(
        ({ id }) => {
          const reply = enc.encode(
            `\n\ndata: {"jsonrpc":"2.0","id":${id},"result":{"content":[]}}\n\n`,
          );
          return sse([chunk, chunk, reply], () => {
            cancelled = true;
          });
        },
        { strictProtocol: true },
      );

      await expect(client.call("read", {})).rejects.toThrow(/MCP response.*size limit/i);
      expect(cancelled).toBe(true);
    },
  );

  it("bounds strict JSON response bodies as well as SSE bodies", async () => {
    const { client } = fakeClient(
      ({ id }) =>
        new Response(
          `${" ".repeat(4 * 1024 * 1024)}{"jsonrpc":"2.0","id":${id},"result":{"content":[]}}`,
          { headers: { "content-type": "application/json" } },
        ),
      { strictProtocol: true },
    );

    await expect(client.call("read", {})).rejects.toThrow(/MCP response.*size limit/i);
  });

  it("does not accept an SSE request as the missing response even when its ID matches", async () => {
    const { client } = fakeClient(
      ({ id }) =>
        sse([new TextEncoder().encode(`data: {"jsonrpc":"2.0","id":${id},"method":"ping"}\n\n`)]),
      { strictProtocol: true },
    );

    await expect(client.call("read", {})).rejects.toThrow(/没有回答 tools\/call/);
  });

  it("does not forward an authenticated POST when redirects are disabled", async () => {
    const paths: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      paths.push(req.url);
      req.resume();
      if (req.url === "/mcp") res.writeHead(307, { location: "/other" }).end();
      else res.writeHead(500).end();
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("missing test server port");
      const client = httpClient({
        url: `http://127.0.0.1:${address.port}/mcp`,
        headers: { "x-test-token": "placeholder" },
        redirect: "error",
      });

      await expect(client.tools()).rejects.toThrow();
      expect(paths).toEqual(["/mcp"]);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
