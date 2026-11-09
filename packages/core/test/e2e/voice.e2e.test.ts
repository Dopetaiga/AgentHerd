// E2E for ADR 0053: the Herder tells the owner each task result in its own words; the agent's reply
// stays one tap below. Without the Herder's words the result still goes out. A real mock agent
// speaks ACP; the Herder is a stand-in.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AgentProfile, ReportView, TextView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../src/clock.ts";
import { Herd } from "../../src/herd.ts";
import type { HerderEvent, VoiceRequest } from "../../src/herder-port.ts";
import { Store } from "../../src/store.ts";
import { VOICE_TIMEOUT_MS } from "../../src/task-report.ts";

const BIN = fileURLToPath(new URL("../../../mock-agent/bin/mock-agent.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "agentherd-voice-"));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

function profile(script: string): AgentProfile {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(file, script);
  return {
    id: "mock",
    name: "Mock",
    command: [process.execPath, BIN, "--script", file],
    env: {},
    exporter: null,
  };
}

async function setup(
  script: string,
  voice: (request: VoiceRequest) => Promise<string | undefined>,
  clock?: FakeClock,
) {
  const channel = new FakeChannel("owner");
  const asked: VoiceRequest[] = [];
  const events: HerderEvent[] = [];
  const store = Store.open(":memory:");
  const tokens: string[] = [];
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    profiles: [profile(script)],
    store,
    boardDebounceMs: 10,
    mcpServer: (token) => {
      tokens.push(token);
      return { name: "agentherd", command: "relay", args: [], env: [] };
    },
    ...(clock === undefined ? {} : { clock }),
    herder: () => ({
      ownerMessage: () => {},
      ownerAnswer: () => {},
      event: (e) => events.push(e),
      voice: (request) => {
        asked.push(request);
        return voice(request);
      },
      stop: async () => {},
    }),
  });
  herds.push(herd);
  await herd.start();
  return { channel, herd, store, asked, events, tokens };
}

const reports = (c: FakeChannel) => c.ofKind("report").map((m) => m.view as ReportView);
const texts = (c: FakeChannel) => c.ofKind("text").map((m) => (m.view as TextView).text);

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const DONE = `
turns:
  - - message: "结论：3 处残留仍存在。清单已存 ~/notes.md"
    - end_turn: end_turn
`;

describe("E2E-HERDER-VOICE (ADR 0053)", () => {
  it("the report is the Herder's words; the agent's reply is the full reply", async () => {
    const { channel, herd, asked, events } = await setup(DONE, async () => "查完了，还剩 3 处。");
    const { turn } = await herd.startTask("mock", dir, "查残留");
    await turn;
    await until(() => reports(channel).length === 1);
    const [report] = reports(channel);
    expect(report?.body).toBe("查完了，还剩 3 处。");
    expect(report?.fullReply).toBe("结论：3 处残留仍存在。清单已存 ~/notes.md");
    expect(report?.result).toBe("done");
    expect(asked).toEqual([
      expect.objectContaining({
        kind: "report",
        title: "查残留",
        result: "done",
        reply: "结论：3 处残留仍存在。清单已存 ~/notes.md",
      }),
    ]);
    // The Herder spoke, so it has the result already.
    expect(events.filter((e) => e.kind === "task-reported")).toEqual([]);
  });

  it("the Herder may say nothing", async () => {
    const { channel, herd, store } = await setup(DONE, async () => "");
    const { turn } = await herd.startTask("mock", dir, "查残留");
    await turn;
    await until(() => store.auditRows("report.silent").length === 1);
    expect(reports(channel)).toEqual([]);
  });

  it("when the Herder cannot speak, the result goes out with the agent's reply", async () => {
    const { channel, herd } = await setup(DONE, async () => {
      throw new Error("model down");
    });
    const { turn } = await herd.startTask("mock", dir, "查残留");
    await turn;
    await until(() => reports(channel).length === 1);
    const [report] = reports(channel);
    expect(report?.body).toBe("主管暂时说不了话，任务的原话在下面「完整回复」里。");
    expect(report?.fullReply).toBe("结论：3 处残留仍存在。清单已存 ~/notes.md");
  });

  it("a Herder that takes too long is not waited for", async () => {
    const clock = new FakeClock();
    const { channel, herd, asked } = await setup(DONE, () => new Promise(() => {}), clock);
    const { turn } = await herd.startTask("mock", dir, "查残留");
    await until(() => asked.length === 1);
    clock.advance(VOICE_TIMEOUT_MS);
    await turn;
    await until(() => reports(channel).length === 1);
    expect(reports(channel)[0]?.fullReply).toBe("结论：3 处残留仍存在。清单已存 ~/notes.md");
  });

  it("a herd_report that needs the owner is told in the Herder's words", async () => {
    const slow = `
turns:
  - - sleep: 400
    - message: "Waiting for the keys."
    - end_turn: end_turn
`;
    const { channel, herd, asked, tokens } = await setup(slow, async (r) =>
      r.kind === "notice" ? "它要 Gmail 的 key，你发我一下？" : "",
    );
    const { turn } = await herd.startTask("mock", dir, "部署邮件监控");
    await until(() => tokens.length > 0);
    await herd.mcp(tokens[0] as string, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "herd_report", arguments: { state: "waiting", summary: "need the keys" } },
    });
    await until(() => texts(channel).includes("它要 Gmail 的 key，你发我一下？"));
    await turn;
    expect(asked[0]).toEqual(
      expect.objectContaining({
        kind: "notice",
        result: "waiting",
        report: expect.objectContaining({ summary: "need the keys" }),
      }),
    );
    expect(texts(channel)).not.toContain("需要你：need the keys");
  });
});
