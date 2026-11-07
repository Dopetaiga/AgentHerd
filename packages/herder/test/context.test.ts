// The Herder's context over the forked kernel (ADR 0041): refs, folds the model writes, the forced
// fold, overflow, restarts and the fallback when the engine fails.

import type { CompressionState } from "@agentherd/context-kernel";
import type { AgentMessage } from "@agentherd/herder-loop";
import { describe, expect, it } from "vitest";
import { HerderContext, withoutContextMarks } from "../src/context.ts";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const SYSTEM = { role: "system", content: "rules", timestamp: 0 } as AgentMessage;

const owner = (text: string): AgentMessage => ({
  role: "user",
  content: [{ type: "text", text: `[Owner's message]\n${text}` }],
  timestamp: 1,
});

const assistant = (content: unknown[], stopReason = "stop"): AgentMessage =>
  ({
    role: "assistant",
    content,
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage,
    stopReason,
    timestamp: 1,
  }) as AgentMessage;

const reply = (text: string) => assistant([{ type: "text", text }]);

const call = (id: string, name: string, args: Record<string, unknown>, text?: string) =>
  assistant(
    [
      ...(text === undefined ? [] : [{ type: "text", text }]),
      { type: "toolCall", id, name, arguments: args },
    ],
    "toolUse",
  );

const result = (id: string, name: string, text: string): AgentMessage =>
  ({
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 1,
  }) as AgentMessage;

/** The text parts of a message or tool result, joined. */
function textOf(m: { content?: unknown } | undefined): string {
  const content = m?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: "text"; text: string } => (c as { type: string }).type === "text")
    .map((c) => c.text)
    .join("\n");
}

function setup(log: AgentMessage[], opts: { window?: number; saved?: CompressionState } = {}) {
  const audits: { type: string; data: Record<string, unknown> }[] = [];
  const box = { messages: [SYSTEM, ...log] };
  const context = new HerderContext(
    {
      contextWindow: () => opts.window ?? 128_000,
      messages: () => box.messages,
      audit: (type, data) => void audits.push({ type, data }),
    },
    log,
    opts.saved,
  );
  return { context, box, audits, project: () => context.project(box.messages) };
}

const tool = (context: HerderContext, name: string) => {
  const found = context.tools().find((t) => t.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
};

const INVOICES = "甲".repeat(6000);
const SUMMARY =
  "主人让我整理三月的发票，附了一大段材料。我整理好了并回复了主人，这件事已经办完，没有要跟进的，也没有提到项目目录或模型。";

/** Two big owner turns, then the model folds the first one with compress. */
async function folded() {
  const s = setup([
    owner(`整理三月的发票 ${INVOICES}`),
    reply("发票整理好了。"),
    owner(`第二件事 ${"乙".repeat(6000)}`),
    reply("第二件也好了。"),
    owner("把发票那段收起来"),
  ]);
  s.project();
  const args = { content: `m00002–m00003 三月发票\n${SUMMARY}` };
  s.box.messages.push(call("k1", "compress", args));
  const done = await tool(s.context, "compress").execute("k1", args);
  s.box.messages.push(result("k1", "compress", textOf(done)));
  return { ...s, done };
}

describe("HerderContext", () => {
  it("shows every message with its ref and leaves tool calls as they were", () => {
    const log = [
      owner("看看任务"),
      call("c1", "session_list", {}, "我看一下"),
      result("c1", "session_list", "Open tasks: none"),
      reply("现在没有任务。"),
    ];
    const out = setup(log).project();
    expect(out[0]).toBe(SYSTEM);
    expect(textOf(out[1])).toMatch(
      /^<acp tokens="\d+" type="text">m00001<\/acp>\n\[Start of the conversation with the owner\./,
    );
    expect(textOf(out[2])).toMatch(/^<acp [^>]*>m00002<\/acp>\n\[Owner's message\]\n看看任务$/);
    const asked = out[3] as Extract<AgentMessage, { role: "assistant" }>;
    expect(textOf(asked)).toMatch(/^<acp [^>]*>m00003<\/acp>\n我看一下$/);
    expect(asked.content[1]).toBe(
      (log[1] as Extract<AgentMessage, { role: "assistant" }>).content[1],
    );
    expect(textOf(out[4])).toMatch(/^<acp [^>]*>m00005<\/acp>\nOpen tasks: none$/);
    expect(textOf(out[5])).toMatch(/^<acp [^>]*>m00006<\/acp>\n现在没有任务。$/);
    expect(out).toHaveLength(6);
    expect(textOf(log[0])).toBe("[Owner's message]\n看看任务");
  });

  it("the model folds a finished part with compress; search_context and decompress bring it back", async () => {
    const { context, project, done, audits } = await folded();
    expect(textOf(done)).toContain("Compressed 1 block(s)");
    expect(audits.map((a) => a.type)).toEqual(["herder.context.compress"]);
    const sent = JSON.stringify(project());
    expect(sent).not.toContain("甲甲甲");
    expect(sent).toContain(SUMMARY);
    expect(sent).toContain("乙乙乙");

    const found = textOf(await tool(context, "search_context").execute("s1", { query: "发票" }));
    expect(found).toContain("b1");
    const shown = textOf(await tool(context, "decompress").execute("d1", { blockId: "b1" }));
    expect(shown).toContain("甲甲甲");
    expect(shown).toContain("It stays folded");
    expect(JSON.stringify(project())).not.toContain("甲甲甲");

    const status = textOf(await tool(context, "acp_status").execute("a1", {}));
    expect(status).toMatch(/^Context: about \d+ of 128000 tokens \(\d+%\), 1 active block\(s\)\./);
  });

  it("refuses a fold without ranges and says how to write one", async () => {
    const { context } = setup([owner("你好"), reply("你好。")]);
    await expect(tool(context, "compress").execute("k1", { content: "收起来" })).rejects.toThrow(
      /no ranges found/,
    );
  });

  it("works in at most 128,000 tokens even when the model reads more", async () => {
    const { context } = setup([owner("你好"), reply("你好。")], { window: 1_000_000 });
    const status = textOf(await tool(context, "acp_status").execute("a1", {}));
    expect(status).toMatch(/ of 128000 tokens /);
  });

  it("folding what is already folded is a receipt, not an error, so the model does not retry", async () => {
    const s = await folded();
    const args = { content: `m00002–m00003 三月发票\n${SUMMARY}` };
    s.box.messages.push(call("k2", "compress", args));
    const again = textOf(await tool(s.context, "compress").execute("k2", args));
    expect(again).toMatch(/^\[Compression no-op: nothing in these ranges needed folding\./);
  });

  it("a fold is kept across a restart: from the saved state, or replayed from the log", async () => {
    const before = await folded();
    const log = before.box.messages.slice(1);
    for (const saved of [structuredClone(before.context.state), undefined]) {
      const after = setup(log, saved === undefined ? {} : { saved });
      const sent = JSON.stringify(after.project());
      expect(sent).not.toContain("甲甲甲");
      expect(sent).toContain(SUMMARY);
      expect(after.audits).toEqual([]);
    }
  });

  it("folds old turns itself when the context is nearly full, keeping the current turn", () => {
    const log: AgentMessage[] = [];
    for (let i = 0; i < 8; i++)
      log.push(owner(`第${i}件事 ${"字".repeat(2500)}`), reply(`第${i}件办好了`));
    log.push(owner("现在呢"));
    const s = setup(log, { window: 20_000 });
    const out = s.project();
    expect(s.audits.map((a) => a.type)).toContain("herder.context.forced-fold");
    const sent = JSON.stringify(out);
    expect(sent).not.toContain(`第0件事 ${"字".repeat(200)}`);
    expect(sent).toContain("Folded without a summary");
    expect(sent).toContain("第0件事 字字"); // the start of each owner message stays in the note
    expect(sent).toContain(`第7件事 ${"字".repeat(2500)}`);
    expect(sent).toContain("现在呢");
    expect(out.length).toBeLessThan(log.length);
  });

  it("after the provider said the request was too long, folds about half", () => {
    const log: AgentMessage[] = [];
    for (let i = 0; i < 6; i++)
      log.push(owner(`第${i}件事 ${"字".repeat(3000)}`), reply(`第${i}件办好了`));
    const s = setup(log);
    expect(s.context.foldForOverflow()).toBe(true);
    const sent = JSON.stringify(s.project());
    expect(sent).not.toContain(`第0件事 ${"字".repeat(200)}`);
    expect(sent).toContain(`第5件事 ${"字".repeat(3000)}`);
  });

  it("a message taken back with a failed turn does not keep its old size in the ref", () => {
    const first = owner("你好");
    const s = setup([first, reply("y".repeat(8000))]);
    expect(textOf(s.project()[3])).toMatch(/^<acp tokens="2\.0K" type="text">m00003<\/acp>\n/);
    s.context.rollback(1);
    s.box.messages = [SYSTEM, first, reply("好")];
    expect(textOf(s.project()[3])).toMatch(/^<acp tokens="1" type="text">m00003<\/acp>\n好$/);
  });

  it("when the engine fails, the newest whole turns go out as they are", () => {
    const s = setup([owner("你好"), reply("你好。"), owner("在吗")]);
    s.context.state = { ...s.context.state, blocks: null } as unknown as CompressionState;
    const out = s.project();
    expect(out).toEqual(s.box.messages);
    expect(s.audits[0]).toMatchObject({
      type: "herder.context.error",
      data: { during: "project" },
    });
  });

  it("removes ref tags the model copied into its text", () => {
    expect(
      withoutContextMarks(
        '<acp tokens="3" type="text">m00005</acp>\n好的，<acp tokens="1.2K" type="session_list">m00007</acp>看过了',
      ),
    ).toBe("好的，看过了");
  });
});
