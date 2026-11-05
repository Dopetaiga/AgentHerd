import { describe, expect, it } from "vitest";
import { modelList, probeModels } from "../src/probe.ts";

type Route = (url: string, headers: Record<string, string>) => Response;

function fakeFetch(route: Route) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    return route(url, headers);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("probeModels", () => {
  it("lists the models of an OpenAI-compatible service, sorted, with the key as Bearer", async () => {
    const f = fakeFetch(() => json({ object: "list", data: [{ id: "gpt-b" }, { id: "gpt-a" }] }));
    const r = await probeModels({ baseUrl: "https://relay.example/v1/", key: "sk-1", fetch: f.fn });
    expect(r).toEqual({
      ok: true,
      models: [
        { id: "gpt-a", name: "gpt-a" },
        { id: "gpt-b", name: "gpt-b" },
      ],
    });
    expect(f.calls.map((c) => c.url)).toEqual(["https://relay.example/v1/models"]);
    expect(f.calls[0]?.headers.authorization).toBe("Bearer sk-1");
  });

  it("finds the list under /v1 and suggests that address when /v1 is missing", async () => {
    const f = fakeFetch((url) =>
      url === "https://relay.example/v1/models"
        ? json({ data: [{ id: "claude-opus" }] })
        : new Response("<html>not found</html>", { status: 404 }),
    );
    const r = await probeModels({ baseUrl: "https://relay.example/", fetch: f.fn });
    expect(r).toEqual({
      ok: true,
      models: [{ id: "claude-opus", name: "claude-opus" }],
      baseUrl: "https://relay.example/v1",
    });
    expect(f.calls.map((c) => c.url)).toEqual([
      "https://relay.example/models",
      "https://relay.example/v1/models",
    ]);
  });

  it("asks /v1/models first for an Anthropic-compatible service and keeps its address", async () => {
    const f = fakeFetch(() =>
      json({ data: [{ id: "claude-x", display_name: "Claude X" }], has_more: false }),
    );
    const r = await probeModels({
      baseUrl: "https://gw.example",
      api: "anthropic-messages",
      key: "k",
      fetch: f.fn,
    });
    expect(r).toEqual({ ok: true, models: [{ id: "claude-x", name: "Claude X" }] });
    expect(f.calls[0]?.url).toBe("https://gw.example/v1/models");
    expect(f.calls[0]?.headers["x-api-key"]).toBe("k");
    expect(f.calls[0]?.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("stops at a refused key and reports the service's message", async () => {
    const f = fakeFetch(() => json({ error: { message: "invalid api key" } }, 401));
    const r = await probeModels({ baseUrl: "https://relay.example", key: "bad", fetch: f.fn });
    expect(r).toEqual({
      ok: false,
      message: "GET https://relay.example/models: HTTP 401 invalid api key",
    });
    expect(f.calls).toHaveLength(1);
  });

  it("reports a bad address and a network failure without throwing", async () => {
    expect(await probeModels({ baseUrl: "relay.example" })).toEqual({
      ok: false,
      message: 'not a valid address: "relay.example"',
    });
    const down = (async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    }) as typeof fetch;
    const r = await probeModels({ baseUrl: "http://localhost:11434/v1", fetch: down });
    expect(r).toEqual({
      ok: false,
      message: "GET http://localhost:11434/v1/models: connect ECONNREFUSED",
    });
  });
});

describe("modelList", () => {
  it("reads OpenAI, Ollama and plain-array answers and drops duplicates", () => {
    expect(modelList({ data: [{ id: "a" }, { id: "a" }] })).toEqual([{ id: "a", name: "a" }]);
    expect(modelList({ models: [{ name: "qwen3:8b" }] })).toEqual([
      { id: "qwen3:8b", name: "qwen3:8b" },
    ]);
    expect(modelList(["m"])).toEqual([{ id: "m", name: "m" }]);
    expect(modelList({ error: "nope" })).toBeUndefined();
  });
});
