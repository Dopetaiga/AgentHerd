// E2E for the agent MCP gateway in the core (docs/spec/09-agent-tools.md §1–§2): each session gets
// the agentherd server with a task token; herd_report sets the stage; the token dies with the task.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StdioMcpServer } from "@agentherd/acp-client";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AgentProfile } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { Herd } from "../../src/herd.ts";
import { UnknownTokenError } from "../../src/mcp-gateway.ts";
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

async function setup(p: AgentProfile) {
  const tokens: string[] = [];
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel: new FakeChannel("owner"),
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
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
  return { herd, tokens };
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
    const answer = herd.mcp(token, report("blocked", "need the Gmail keys"));
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
    expect(herd.mcp(token, { jsonrpc: "2.0", id: 1, method: "ping" })?.result).toEqual({});
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
