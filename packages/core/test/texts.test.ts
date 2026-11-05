import { describe, expect, it } from "vitest";
import { itemView } from "../src/inbox.ts";
import { reportView } from "../src/report.ts";
import type { Task } from "../src/tasks.ts";
import { CORE_TEXTS, coreTexts } from "../src/texts.ts";

describe("core texts", () => {
  it("both locales define the same keys", () => {
    expect(Object.keys(CORE_TEXTS["zh-CN"]).sort()).toEqual(Object.keys(CORE_TEXTS.en).sort());
  });

  it("Chinese item cards have Chinese buttons and reason", () => {
    const view = itemView(
      {
        id: "i1",
        sessionId: "s1",
        kind: "permission",
        title: "Run npm test",
        body: "",
        risk: "low",
        state: "open",
        createdAt: "2026-11-04T00:00:00.000Z",
        toolCall: { id: "t1", command: "npm test", rawInput: { justification: "跑测试" } },
      } as never,
      "规则",
      undefined,
      coreTexts("zh-CN"),
    );
    expect(view.options.map((o) => o.label)).toEqual(["批准", "拒绝"]);
    expect(view.body).toContain("理由：跑测试");
  });

  it("pipeline reasons are shown in the owner's language", () => {
    const item = {
      id: "i1",
      sessionId: "s1",
      kind: "permission",
      title: "ls",
      body: "",
      risk: "medium",
      state: "open",
      createdAt: "2026-11-04T00:00:00.000Z",
      toolCall: { id: "t1", command: "ls" },
    } as never;
    const zh = coreTexts("zh-CN");
    expect(itemView(item, "no rule matched", undefined, zh).reason).toBe(
      "没有规则自动处理这个请求",
    );
    expect(itemView(item, "guard list: secret file", undefined, zh).reason).toBe(
      "碰到保护名单：secret file",
    );
    expect(itemView(item, "no rule matched", undefined, coreTexts("en")).reason).toBe(
      "no rule matched",
    );
  });

  it("Chinese report titles and results", () => {
    const task: Task = {
      id: "t",
      title: "写笔记",
      project: "notes",
      agent: "dsh",
      stage: "stuck",
      lastReport: "",
      startedAt: "2026-11-04T00:00:00.000Z",
      updatedAt: "2026-11-04T00:00:00.000Z",
      automaticDecisions: [],
    };
    const view = reportView(
      task,
      { body: "x", summarized: false },
      new Date("2026-11-04T00:00:40.000Z"),
      coreTexts("zh-CN"),
    );
    expect(view.result).toBe("blocked");
    expect(view.title).toBe("受阻：写笔记 · notes · dsh · 40s");
  });

  it("agent prompts stay labeled as AgentHerd", () => {
    for (const t of Object.values(CORE_TEXTS)) {
      expect(t.replyHint(300)).toMatch(/^\[AgentHerd\]/);
      expect(t.summaryPrompt(600)).toMatch(/^\[AgentHerd\]/);
    }
  });
});
