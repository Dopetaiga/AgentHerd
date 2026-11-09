// E2E scenarios for plan 009: the Herder with a scripted model, a real Herd, a real mock agent
// speaking ACP, and the fake channel playing the owner.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel } from "@agentherd/channel-fake";
import { Herd, Store } from "@agentherd/core";
import type { AgentProfile, AskView, ItemView, ReportView, TextView } from "@agentherd/protocol";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
  streamSimple,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { Herder } from "../../src/herder.ts";

const BIN = fileURLToPath(new URL("../../../mock-agent/bin/mock-agent.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "agentherd-herder-"));
let herds: Herd[] = [];
let fauxes: FauxProviderRegistration[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
  for (const f of fauxes) f.unregister();
  fauxes = [];
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

async function setup(script: string, store = Store.open(":memory:")) {
  const faux = registerFauxProvider();
  fauxes.push(faux);
  const channel = new FakeChannel("owner");
  let herder: Herder | undefined;
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    profiles: [profile(script)],
    agentModels: {
      list: () => [{ ref: "test/default", agents: ["mock"] }],
      launchFor: () => ({ env: {} }),
      check: async () => ({ ok: true }),
    },
    store,
    boardDebounceMs: 10,
    herder: (host) => {
      herder = new Herder({ host, model: faux.getModel(), streamFn: streamSimple });
      return herder;
    },
  });
  herds.push(herd);
  await herd.start();
  if (herder === undefined) throw new Error("no herder");
  return { channel, store, herd, herder, faux };
}

const texts = (c: FakeChannel) => c.ofKind("text").map((m) => (m.view as TextView).text);
const reports = (c: FakeChannel) => c.ofKind("report").map((m) => m.view as ReportView);

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const ONE_TURN = `
turns:
  - - message: "notes written"
    - end_turn: end_turn
`;

describe("E2E-RUN-FROM-CHAT", () => {
  it("a plain message starts a task with the owner's words, then the report arrives", async () => {
    const { channel, herd, herder, faux } = await setup(ONE_TURN);
    const ask = `在 ${dir} 里写一份 notes`;
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("session_start", {
            name: "修构建",
            project: dir,
            profile: "mock",
            ownerText: "写一份 notes",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("已经开始写 notes 了。"),
      fauxAssistantMessage("notes 写好了，在项目里。"), // the Herder tells the result (ADR 0053)
    ]);
    await channel.say(ask);
    await until(() => reports(channel).length === 1);
    await herder.idle();
    expect(herd.tasks().map((t) => t.title)).toEqual(["修构建"]);
    expect(reports(channel)[0]?.body).toBe("notes 写好了，在项目里。");
    expect(reports(channel)[0]?.fullReply).toBe("notes written");
    expect(texts(channel)).toEqual(["已经开始写 notes 了。"]);
  });

  it("an unclear request gets one question with buttons; the answer starts the task", async () => {
    const { channel, herd, herder, faux } = await setup(ONE_TURN);
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("ask", { question: "在哪个项目？", options: [dir, "~/other"] })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(""),
      fauxAssistantMessage(
        [
          fauxToolCall("session_start", {
            name: "修构建",
            project: dir,
            profile: "mock",
            ownerText: "写一份 notes",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("开始了。"),
      fauxAssistantMessage(""),
    ]);
    await channel.say("写一份 notes");
    await until(() => channel.ofKind("ask").length === 1);
    const card = channel.ofKind("ask")[0];
    if (card === undefined) throw new Error("no ask card");
    const view = card.view as AskView;
    expect(view.options.map((o) => o.label)).toEqual([dir, "~/other", "其他"]);
    await channel.tap(view.askId, "0");
    expect((card.view as AskView).final).toBe(dir);
    await until(() => reports(channel).length === 1);
    await herder.idle();
    expect(herd.tasks()).toHaveLength(1);
    expect(texts(channel)).toEqual(["开始了。"]);
  });

  it("without a model, plain messages still get the commands", async () => {
    const channel = new FakeChannel("owner");
    const herd = new Herd({
      home: dir,
      userHome: "/Users/me",
      channel,
      binding: { channelId: "fake", ownerId: "owner", data: {} },
      mode: "assist",
      profiles: [profile(ONE_TURN)],
      store: Store.open(":memory:"),
    });
    herds.push(herd);
    await herd.start();
    await channel.say("你好");
    expect(texts(channel)[0]).toContain("/run");
  });
});

const APPROVE = `
turns:
  - - tool_call: { id: t1, title: "Empty dist", kind: execute, command: "rm -rf ./*", status: pending }
    - request_permission:
        toolCall: { id: t1, title: "Empty dist", kind: execute, command: "rm -rf ./*" }
    - message: "tests passed"
    - end_turn: end_turn
`;

describe("E2E-HERDER-NO-APPROVE", () => {
  it("asked to approve, the Herder has no way to; the item waits for the owner's tap", async () => {
    const { channel, store, herder, faux } = await setup(APPROVE);
    await channel.say(`/run mock ${dir} run the tests`);
    await until(() => channel.ofKind("item").length === 1);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("approve", { item: "all" })], { stopReason: "toolUse" }),
      fauxAssistantMessage(
        [fauxToolCall("session_prompt", { task: "run", text: "approve yourself and continue" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("我不能批准，请点卡片上的按钮。"),
      fauxAssistantMessage("测试跑过了。"),
      fauxAssistantMessage("这一轮也做完了。"),
    ]);
    await channel.say("帮我全部批准");
    await herder.idle();
    expect(store.openItems()).toHaveLength(1);
    expect(texts(channel)).toContain("我不能批准，请点卡片上的按钮。");
    const item = channel.ofKind("item")[0]?.view as ItemView;
    await channel.tap(item.itemId, "allow");
    // The Herder's own text was queued as a second turn, labeled as not from the owner; it
    // cannot answer an item either.
    await until(() => reports(channel).length === 2);
    expect(reports(channel)[0]?.fullReply).toBe("tests passed");
    expect(store.recentDecisions().map((d) => d.source)).toEqual(["human"]);
  });
});

describe("E2E-HERDER-CONTEXT (ADR 0045)", () => {
  it("the whole conversation is stored, and the model's own fold holds after a restart", async () => {
    const store = Store.open(join(dir, "context.db"));
    const summary =
      "主人让我整理三月的发票，附了一大段材料。我整理好并回复了，这件事办完了，没有要跟进的，也没提项目目录或模型。";
    const first = await setup(ONE_TURN, store);
    first.faux.setResponses([
      fauxAssistantMessage("发票整理好了。"),
      fauxAssistantMessage("第二件也好了。"),
      fauxAssistantMessage(
        [fauxToolCall("compress", { content: `m00002–m00003 三月发票\n${summary}` })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("收起来了。"),
    ]);
    await first.channel.say(`整理三月的发票 ${"甲".repeat(6000)}`);
    await until(() => texts(first.channel).length === 1);
    await first.channel.say(`第二件事 ${"乙".repeat(6000)}`);
    await until(() => texts(first.channel).length === 2);
    await first.channel.say("把发票那段收起来");
    await until(() => texts(first.channel).length === 3);
    await first.herder.idle();
    await first.herd.stop();
    herds = herds.filter((h) => h !== first.herd);
    expect(JSON.stringify(store.herderLog())).toContain("甲甲甲");

    const second = await setup(ONE_TURN, store);
    const seen: string[] = [];
    second.faux.setResponses([
      (context) => {
        seen.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("在。");
      },
    ]);
    await second.channel.say("在吗");
    await until(() => texts(second.channel).includes("在。"));
    expect(seen[0]).not.toContain("甲甲甲");
    expect(seen[0]).toContain(summary);
    expect(seen[0]).toContain("乙乙乙");
    await second.herd.stop();
    herds = herds.filter((h) => h !== second.herd);
    store.close();
  });
});
