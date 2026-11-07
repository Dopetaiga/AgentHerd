// E2E for the agent MCP gateway in the core (docs/spec/09-agent-tools.md §1–§2): each session gets
// the agentherd server with a task token; herd_report sets the stage; the token dies with the task.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StdioMcpServer } from "@agentherd/acp-client";
import { FakeChannel, type SentMessage } from "@agentherd/channel-fake";
import type { AgentProfile, ItemView, Mode } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { Herd } from "../../src/herd.ts";
import { type AppTools, UnknownTokenError } from "../../src/mcp-gateway.ts";
import { Store } from "../../src/store.ts";

const BIN = fileURLToPath(new URL("../../../mock-agent/bin/mock-agent.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "agentherd-mcp-"));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

const SLOW = `
turns:
  - - sleep: 400
    - message: "Done."
    - end_turn: end_turn
`;

function profile(script: string, extra: Partial<AgentProfile> = {}): AgentProfile {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(file, script);
  return {
    id: "mock",
    name: "Mock",
    command: [process.execPath, BIN, "--script", file],
    env: {},
    exporter: null,
    ...extra,
  };
}

async function setup(p: AgentProfile, apps?: AppTools, mode: Mode = "assist") {
  const tokens: string[] = [];
  const channel = new FakeChannel("owner");
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode,
    ...(apps === undefined ? {} : { apps: () => apps }),
    locale: "en",
    profiles: [p],
    store: Store.open(":memory:"),
    boardDebounceMs: 10,
    mcpServer: (token): StdioMcpServer => {
      tokens.push(token);
      return { name: "agentherd", command: "relay", args: [], env: [{ name: "T", value: token }] };
    },
  });
  herds.push(herd);
  await herd.start();
  return { herd, tokens, channel };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
}

const report = (state: string, summary: string) => ({
  jsonrpc: "2.0" as const,
  id: 1,
  method: "tools/call",
  params: { name: "herd_report", arguments: { state, summary } },
});

describe("E2E-MCP-HERD-REPORT", () => {
  it("a herd_report during a turn sets the stage and the board line", async () => {
    const { herd, tokens } = await setup(profile(SLOW));
    const run = herd.run("mock", dir, "Deploy the mail monitor");
    await until(() => tokens.length > 0 && herd.tasks()[0]?.stage === "working");
    const token = tokens[0] as string;
    const answer = await herd.mcp(token, report("blocked", "need the Gmail keys"));
    expect(answer?.result).toEqual({ content: [{ type: "text", text: "reported" }] });
    await run;
    const [task] = herd.tasks();
    expect(task?.stage).toBe("stuck");
    expect(task?.lastReport).not.toBe("");
  });

  it("the token stops working when the task ends", async () => {
    const { herd, tokens } = await setup(profile(SLOW));
    const { taskId, turn } = await herd.startTask("mock", dir, "Look around");
    await turn;
    const token = tokens[0] as string;
    expect((await herd.mcp(token, { jsonrpc: "2.0", id: 1, method: "ping" }))?.result).toEqual({});
    await herd.endTask(taskId, "test");
    expect(() => herd.mcp(token, { jsonrpc: "2.0", id: 2, method: "ping" })).toThrow(
      UnknownTokenError,
    );
  });

  it("a profile with mcp: false gets no server", async () => {
    const { herd, tokens } = await setup(profile(SLOW, { mcp: false }));
    await herd.run("mock", dir, "Look around");
    expect(tokens).toEqual([]);
  });
});

const hints = (h: Partial<Record<"readOnly" | "create" | "update" | "destructive", boolean>>) => ({
  readOnly: false,
  create: false,
  update: false,
  destructive: false,
  ...h,
});

function fakeApps(ran: string[]): AppTools {
  const known = {
    GMAIL_FETCH_EMAILS: {
      title: "Gmail: Fetch emails",
      toolkit: "gmail",
      hints: hints({ readOnly: true }),
    },
    GMAIL_SEND_EMAIL: {
      title: "Gmail: Send email",
      toolkit: "gmail",
      hints: hints({ create: true }),
    },
    GMAIL_DELETE_MESSAGE: {
      title: "Gmail: Delete message",
      toolkit: "gmail",
      hints: hints({ destructive: true }),
    },
  } as const;
  return {
    list: async () => [{ name: "COMPOSIO_MULTI_EXECUTE_TOOL", inputSchema: {} }],
    describe: async (slugs) =>
      new Map(
        slugs.flatMap((s) => (s in known ? [[s, known[s as keyof typeof known]] as const] : [])),
      ),
    call: async (_name, args) => {
      for (const t of (args as { tools: { tool_slug: string }[] }).tools) ran.push(t.tool_slug);
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
}

const run = (...slugs: string[]) => ({
  jsonrpc: "2.0" as const,
  id: 7,
  method: "tools/call",
  params: {
    name: "COMPOSIO_MULTI_EXECUTE_TOOL",
    arguments: {
      tools: slugs.map((tool_slug) => ({ tool_slug, arguments: {} })),
      sync_response_to_workbench: false,
    },
  },
});

const isOpenItem = (m: SentMessage) =>
  m.view.kind === "item" && (m.view as ItemView).final === undefined;

describe("E2E-MCP-APPS", () => {
  it("a read and a write run without asking; the write goes into the report", async () => {
    const ran: string[] = [];
    const { herd, tokens, channel } = await setup(profile(SLOW), fakeApps(ran));
    const { taskId, turn } = await herd.startTask("mock", dir, "Mail Bob");
    await until(() => tokens.length > 0);
    const answer = await herd.mcp(
      tokens[0] as string,
      run("GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"),
    );
    expect(answer?.result).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(ran).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"]);
    expect(channel.messages.some(isOpenItem)).toBe(false);
    await turn;
    expect(herd.tasks().find((t) => t.id === taskId)?.automaticDecisions).toContain(
      "Ran on its own: Gmail: Fetch emails, Gmail: Send email",
    );
  });

  it("a delete waits for the owner and a deny reaches the agent as a tool error", async () => {
    const ran: string[] = [];
    const { herd, tokens, channel } = await setup(profile(SLOW), fakeApps(ran));
    const { turn } = await herd.startTask("mock", dir, "Clean the inbox");
    await until(() => tokens.length > 0);
    const pending = herd.mcp(
      tokens[0] as string,
      run("GMAIL_FETCH_EMAILS", "GMAIL_DELETE_MESSAGE"),
    );
    const card = await channel.waitFor(isOpenItem);
    expect((card.view as ItemView).title).toBe("Gmail: Fetch emails, Gmail: Delete message");
    await channel.tap((card.view as ItemView).itemId, "deny");
    expect((await pending)?.result).toEqual({
      content: [
        {
          type: "text",
          text: "The owner did not allow Gmail: Fetch emails, Gmail: Delete message.",
        },
      ],
      isError: true,
    });
    expect(ran).toEqual([]);
    await turn;
  });

  it("in observe mode a write goes to the owner and runs once allowed", async () => {
    const ran: string[] = [];
    const { herd, tokens, channel } = await setup(profile(SLOW), fakeApps(ran), "observe");
    const { turn } = await herd.startTask("mock", dir, "Mail Bob");
    await until(() => tokens.length > 0);
    const pending = herd.mcp(tokens[0] as string, run("GMAIL_SEND_EMAIL"));
    const card = await channel.waitFor(isOpenItem);
    await channel.tap((card.view as ItemView).itemId, "allow");
    expect((await pending)?.result).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(ran).toEqual(["GMAIL_SEND_EMAIL"]);
    await turn;
  });

  it("a tool without hints goes to the owner", async () => {
    const ran: string[] = [];
    const { herd, tokens, channel } = await setup(profile(SLOW), fakeApps(ran));
    const { turn } = await herd.startTask("mock", dir, "Do something");
    await until(() => tokens.length > 0);
    const pending = herd.mcp(tokens[0] as string, run("WEIRD_TOOL"));
    const card = await channel.waitFor(isOpenItem);
    await channel.tap((card.view as ItemView).itemId, "allow");
    await pending;
    expect(ran).toEqual(["WEIRD_TOOL"]);
    await turn;
  });
});
