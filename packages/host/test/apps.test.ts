import type { SecretStore } from "@agentherd/core";
import { describe, expect, it } from "vitest";
import { Apps, type AppsView, COMPOSIO_ACCOUNT, newComposioUserId } from "../src/apps.ts";
import {
  type ComposioClient,
  ComposioError,
  type ComposioToolkit,
  type McpHttpClient,
} from "../src/composio.ts";

function memorySecrets(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (a) => data.get(a),
    set: (a, v) => {
      data.set(a, v);
    },
    delete: (a) => {
      data.delete(a);
    },
  };
}

interface FakeComposio {
  calls: string[];
  sessions: string[][];
  accounts: Map<string, string>;
  connected: ComposioToolkit[];
  client: (key: string) => ComposioClient;
}

const GMAIL: ComposioToolkit = { slug: "gmail", name: "Gmail", noAuth: false };
const GITHUB: ComposioToolkit = { slug: "github", name: "GitHub", noAuth: false };

function fakeComposio(): FakeComposio {
  const f: FakeComposio = {
    calls: [],
    sessions: [],
    accounts: new Map(),
    connected: [],
    client: (key) => ({
      async checkKey() {
        f.calls.push(`check ${key}`);
        if (key !== "good" && key !== "read-only") {
          throw new ComposioError("Invalid API key", 401, "APIKey_InvalidAPIKey");
        }
      },
      async createSession(_user, toolkits) {
        if (key === "read-only") {
          throw new ComposioError(
            'This API key does not have the permissions required for POST /api/v3.1/tool_router/session. This route requires "session_management" write access, but the key has read access for "session_management".',
            403,
          );
        }
        f.sessions.push([...toolkits]);
        return { id: `s${f.sessions.length}`, mcpUrl: `https://mcp/s${f.sessions.length}` };
      },
      async toolkits(_s, opts = {}) {
        f.calls.push(`toolkits ${JSON.stringify(opts)}`);
        if (opts.connected === true) return f.connected;
        return [GMAIL, GITHUB].map((t) => f.connected.find((c) => c.slug === t.slug) ?? t);
      },
      async link(_s, toolkit) {
        f.accounts.set("ca_1", "INITIATED");
        return { url: `https://auth/${toolkit}`, accountId: "ca_1" };
      },
      async account(id) {
        return { status: f.accounts.get(id) ?? "FAILED", toolkit: "gmail" };
      },
      async disconnect(id) {
        f.calls.push(`disconnect ${id}`);
        f.connected = [];
      },
      async tool(slug) {
        f.calls.push(`tool ${slug}`);
        if (slug === "GMAIL_SEND_EMAIL") {
          return {
            slug,
            name: "Send email",
            toolkit: "gmail",
            toolkitName: "Gmail",
            tags: ["createHint"],
          };
        }
        throw new ComposioError("not found", 404);
      },
    }),
  };
  return f;
}

function setup(key?: string) {
  const secrets = memorySecrets();
  if (key !== undefined) secrets.set(COMPOSIO_ACCOUNT, key);
  const composio = fakeComposio();
  const emitted: AppsView[] = [];
  let now = 0;
  const mcpCalls: string[] = [];
  const mcp = (url: string): McpHttpClient => ({
    listTools: async () => {
      mcpCalls.push(`list ${url}`);
      return [];
    },
    callTool: async (name) => {
      mcpCalls.push(`call ${url} ${name}`);
      return { content: [] };
    },
  });
  const apps = new Apps({
    secrets,
    userId: () => "agentherd-0123456789abcdef",
    emit: (v) => emitted.push(v),
    client: composio.client,
    mcp,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      // A real tick, so the test can change the account between polls.
      await new Promise((r) => setTimeout(r, 1));
    },
  });
  return { apps, secrets, composio, emitted, mcpCalls, advance: (ms: number) => (now += ms) };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 1));
}

describe("Apps", () => {
  it("makes user ids like agentherd-<16 hex>", () => {
    expect(newComposioUserId()).toMatch(/^agentherd-[0-9a-f]{16}$/);
  });

  it("without a key shows nothing, asks Composio nothing and gives agents no tools", async () => {
    const { apps, composio } = setup();
    expect(await apps.view()).toEqual({ hasKey: false, apps: [] });
    expect(apps.appTools()).toBeUndefined();
    expect(apps.connectedNames()).toEqual([]);
    expect(composio.calls).toEqual([]);
  });

  it("does not save a bad key and says why", async () => {
    const { apps, secrets } = setup();
    const view = await apps.setKey("bad");
    expect(view.problem).toContain("这个 Composio API Key 不能用");
    expect(secrets.data.has(COMPOSIO_ACCOUNT)).toBe(false);
  });

  it("does not save a key that may not make sessions, and says which right it lacks", async () => {
    const { apps, secrets } = setup();
    const view = await apps.setKey("read-only");
    expect(view.problem).toContain("session_management 的写权限");
    expect(secrets.data.has(COMPOSIO_ACCOUNT)).toBe(false);
  });

  it("saves a good key and never puts it in a view", async () => {
    const { apps, secrets, emitted } = setup();
    const view = await apps.setKey("  good  ");
    expect(secrets.data.get(COMPOSIO_ACCOUNT)).toBe("good");
    expect(view.hasKey).toBe(true);
    expect(view.apps.map((a) => a.slug)).toEqual(["gmail", "github"]);
    expect(JSON.stringify([view, ...emitted])).not.toContain("good");
    expect((await apps.setKey("")).hasKey).toBe(false);
    expect(secrets.data.has(COMPOSIO_ACCOUNT)).toBe(false);
  });

  it("connects an app: link, poll until ACTIVE, then agents get a session with it", async () => {
    const { apps, composio, emitted, mcpCalls } = setup("good");
    const tools = apps.appTools();
    await tools?.list();
    expect(composio.sessions.at(-1)).toEqual([]);
    expect(await apps.connect("gmail")).toEqual({ url: "https://auth/gmail" });
    await until(() => emitted.some((v) => v.apps.some((a) => a.connecting)));
    composio.accounts.set("ca_1", "ACTIVE");
    composio.connected = [{ ...GMAIL, account: { id: "ca_1", status: "ACTIVE" } }];
    await until(() => emitted.some((v) => v.apps.some((a) => a.slug === "gmail" && a.connected)));
    const last = emitted.at(-1) as AppsView;
    expect(last.apps[0]).toMatchObject({ slug: "gmail", connected: true, connecting: false });
    expect(apps.connectedNames()).toEqual(["Gmail"]);
    await tools?.call("COMPOSIO_SEARCH_TOOLS", {});
    expect(composio.sessions.at(-1)).toEqual(["gmail"]);
    expect(mcpCalls.at(-1)).toMatch(/^call https:\/\/mcp\/s\d+ COMPOSIO_SEARCH_TOOLS$/);
  });

  it("a sign-in that fails shows a problem", async () => {
    const { apps, composio, emitted } = setup("good");
    await apps.connect("gmail");
    composio.accounts.set("ca_1", "EXPIRED");
    await until(() => emitted.some((v) => v.problem !== undefined));
    expect(emitted.at(-1)?.problem).toBe("gmail 没有连上（EXPIRED）");
  });

  it("disconnect deletes the account", async () => {
    const { apps, composio } = setup("good");
    composio.connected = [{ ...GMAIL, account: { id: "ca_7", status: "ACTIVE" } }];
    const view = await apps.disconnect("gmail");
    expect(composio.calls).toContain("disconnect ca_7");
    expect(view.apps.find((a) => a.slug === "gmail")?.connected).toBe(false);
  });

  it("describes tools with hints, caches a day, and leaves unknown tools out", async () => {
    const { apps, composio, advance } = setup("good");
    const tools = apps.appTools();
    const first = await tools?.describe(["GMAIL_SEND_EMAIL", "NOPE"]);
    expect(first?.get("GMAIL_SEND_EMAIL")).toEqual({
      title: "Gmail: Send email",
      toolkit: "gmail",
      hints: { readOnly: false, create: true, update: false, destructive: false },
    });
    expect(first?.has("NOPE")).toBe(false);
    await tools?.describe(["GMAIL_SEND_EMAIL"]);
    expect(composio.calls.filter((c) => c === "tool GMAIL_SEND_EMAIL")).toHaveLength(1);
    advance(25 * 60 * 60_000);
    await tools?.describe(["GMAIL_SEND_EMAIL"]);
    expect(composio.calls.filter((c) => c === "tool GMAIL_SEND_EMAIL")).toHaveLength(2);
  });
});
