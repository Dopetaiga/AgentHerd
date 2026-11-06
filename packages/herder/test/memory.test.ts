import { Store } from "@agentherd/core";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
  streamSimple,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { Herder, MEMORY_REFRESH_MS, REVIEW_EVERY_TURNS } from "../src/herder.ts";
import { memorySnapshot, memoryTools, opProblem, recallBlock } from "../src/memory.ts";
import type { TurnContext } from "../src/tools.ts";
import { fakeHost } from "./helpers.ts";

function turn(typedText: string, kind: TurnContext["kind"] = "owner"): TurnContext {
  return {
    kind,
    ownerText: typedText,
    typedText,
    images: [],
    asked: false,
    notified: false,
    pickedDirs: [],
  };
}

function setupTools(text: string) {
  const store = Store.open(":memory:");
  const ctx = turn(text);
  const byName = new Map(memoryTools(store.memory, () => ctx).map((t) => [t.name, t]));
  const call = async (name: string, args: unknown) => {
    const result = await byName.get(name)?.execute("id", args as never);
    return result?.content.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
  };
  return { store, ctx, call };
}

describe("memory checks", () => {
  const said = turn("以后报告都用中文，三行以内。帮我看下 pi-desktop 的 issue");

  it("keeps a lasting preference in the owner's words", () => {
    expect(
      opProblem(
        {
          action: "add",
          kind: "owner",
          content: "主人希望报告用中文、三行以内",
          evidence: "以后报告都用中文，三行以内",
        },
        said,
      ),
    ).toBeUndefined();
  });

  it("refuses evidence the owner did not type", () => {
    expect(
      opProblem(
        { action: "add", kind: "owner", content: "喜欢英文", evidence: "以后都用英文" },
        said,
      ),
    ).toContain("copied exactly");
  });

  it("refuses a one-off request as a preference", () => {
    expect(
      opProblem(
        {
          action: "add",
          kind: "owner",
          content: "主人关心 pi-desktop",
          evidence: "帮我看下 pi-desktop 的 issue",
        },
        said,
      ),
    ).toContain("did not say this lasts");
  });

  it("refuses questions and ifs", () => {
    const t = turn("以后是不是都用 kimi 比较好？");
    expect(
      opProblem(
        {
          action: "add",
          kind: "owner",
          content: "用 kimi",
          evidence: "以后是不是都用 kimi 比较好？",
        },
        t,
      ),
    ).toContain("question");
  });

  it("never keeps temporary folders, and other paths only in the owner's words", () => {
    const t = turn("记住 pi-desktop 在 ~/learn-agent/pi-desktop");
    expect(
      opProblem({ action: "add", kind: "project", content: "演示项目在 /tmp/demo" }, t),
    ).toContain("temporary");
    expect(
      opProblem({ action: "add", kind: "project", content: "AgentHerd 在 ~/code/AgentHerd" }, t),
    ).toContain("not in the owner's words");
    expect(
      opProblem(
        {
          action: "add",
          kind: "project",
          content: "pi-desktop 在 ~/learn-agent/pi-desktop",
          evidence: "pi-desktop 在 ~/learn-agent/pi-desktop",
        },
        t,
      ),
    ).toBeUndefined();
  });

  it("needs evidence for people, not for the Herder's own notes", () => {
    const t = turn("小王负责前端");
    expect(opProblem({ action: "add", kind: "person", content: "小王负责前端" }, t)).toContain(
      "need evidence",
    );
    expect(
      opProblem({ action: "add", kind: "note", content: "deepseek 在晚上常超时，可换 kimi" }, t),
    ).toBeUndefined();
  });

  it("writes nothing on an event turn and leaves cases to AgentHerd", () => {
    expect(opProblem({ action: "add", kind: "note", content: "x" }, turn("", "event"))).toContain(
      "only while answering",
    );
    expect(opProblem({ action: "add", kind: "case", content: "x" }, said)).toContain(
      "kind must be",
    );
  });
});

describe("memory tools", () => {
  it("saves, replaces and removes; a failed check saves nothing", async () => {
    const { store, ctx, call } = setupTools("以后报告都用中文");
    await call("memory", {
      operations: [
        { action: "add", kind: "owner", content: "报告用中文", evidence: "以后报告都用中文" },
      ],
    });
    const [row] = store.memory.list();
    expect(row).toMatchObject({
      abstract: "报告用中文",
      source: "said",
      evidence: "以后报告都用中文",
    });

    ctx.typedText = "不对，以后报告用英文";
    ctx.ownerText = ctx.typedText;
    await expect(
      call("memory", {
        operations: [
          {
            action: "replace",
            id: row?.id.slice(0, 8),
            content: "报告用英文",
            evidence: "以后报告用英文",
          },
          { action: "add", kind: "owner", content: "随便", evidence: "瞎编的" },
        ],
      }),
    ).rejects.toThrow("not saved");
    expect(store.memory.list().map((r) => r.abstract)).toEqual(["报告用中文"]);

    await call("memory", {
      operations: [
        {
          action: "replace",
          id: row?.id.slice(0, 8),
          content: "报告用英文",
          evidence: "以后报告用英文",
        },
      ],
    });
    expect(store.memory.list().map((r) => r.abstract)).toEqual(["报告用英文"]);
  });

  it("when full, fails with what is there so the Herder can make room in one batch", async () => {
    const { store, call } = setupTools("以后都记住这个");
    for (let i = 0; i < 6; i++) {
      store.memory.write([{ op: "add", kind: "owner", abstract: `${i}${"偏".repeat(199)}` }], {
        actor: "herder",
        source: "said",
      });
    }
    await expect(
      call("memory", {
        operations: [
          { action: "add", kind: "owner", content: "很".repeat(199), evidence: "以后都记住这个" },
        ],
      }),
    ).rejects.toThrow(/would hold \d+ of 1375[\s\S]*Retry as ONE/);
  });

  it("searches people, projects, cases and experience", async () => {
    const { store, call } = setupTools("");
    store.memory.write([{ op: "add", kind: "case", abstract: "修复 pi-desktop 打包签名失败" }], {
      actor: "task",
      source: "task",
    });
    expect(await call("memory_search", { query: "打包签名" })).toContain(
      "修复 pi-desktop 打包签名失败",
    );
    expect(await call("memory_search", { query: "完全无关的东西" })).toBe("(nothing found)");
  });
});

describe("snapshot and recall", () => {
  it("the snapshot shows owner entries and notes with how full they are", () => {
    const store = Store.open(":memory:");
    expect(memorySnapshot(store.memory)).toBe("");
    store.memory.write(
      [
        { op: "add", kind: "owner", abstract: "报告用中文" },
        { op: "add", kind: "person", abstract: "小王负责前端" },
      ],
      { actor: "herder", source: "said" },
    );
    const snap = memorySnapshot(store.memory);
    expect(snap).toContain("用量 5/1375 字");
    expect(snap).toContain("报告用中文");
    expect(snap).not.toContain("小王");
  });

  it("recall finds non-resident entries for a message", () => {
    const store = Store.open(":memory:");
    store.memory.write(
      [
        { op: "add", kind: "person", abstract: "小王负责 pi-desktop 前端" },
        { op: "add", kind: "owner", abstract: "pi-desktop 报告用中文" },
      ],
      { actor: "herder", source: "said" },
    );
    const block = recallBlock(store.memory, "让小王看看 pi-desktop");
    expect(block).toContain("[记忆召回");
    expect(block).toContain("小王负责");
    expect(block).not.toContain("报告用中文");
    expect(recallBlock(store.memory, "天气")).toBe("");
  });
});

let faux: FauxProviderRegistration[] = [];
afterEach(() => {
  for (const f of faux) f.unregister();
  faux = [];
});

describe("Herder with memory", () => {
  it("puts memory in the system prompt, adds recall, and refreshes after a long pause", async () => {
    const store = Store.open(":memory:");
    store.memory.write([{ op: "add", kind: "owner", abstract: "主人希望报告三行以内" }], {
      actor: "herder",
      source: "said",
    });
    store.memory.write([{ op: "add", kind: "person", abstract: "小王负责前端" }], {
      actor: "herder",
      source: "said",
    });
    const registration = registerFauxProvider();
    faux.push(registration);
    const { host } = fakeHost({ memory: store.memory });
    let now = 1_000_000;
    const herder = new Herder({
      host,
      model: registration.getModel(),
      streamFn: streamSimple,
      sleep: async () => {},
      now: () => now,
    });
    const systems: string[] = [];
    const lasts: string[] = [];
    const see = (context: { systemPrompt?: string; messages: unknown[] }) => {
      systems.push(JSON.stringify(context.systemPrompt ?? context.messages[0]));
      lasts.push(JSON.stringify(context.messages.at(-1)));
    };
    registration.setResponses([
      (context) => {
        see(context as never);
        return fauxAssistantMessage(
          [
            fauxToolCall("memory", {
              operations: [
                {
                  action: "add",
                  kind: "owner",
                  content: "主人默认用 kimi",
                  evidence: "以后默认用 kimi",
                },
              ],
            }),
          ],
          { stopReason: "toolUse" },
        );
      },
      () => fauxAssistantMessage("好。"),
      (context) => {
        see(context as never);
        return fauxAssistantMessage("好。");
      },
      (context) => {
        see(context as never);
        return fauxAssistantMessage("好。");
      },
    ]);
    herder.ownerMessage("以后默认用 kimi，小王那边的前端呢");
    await herder.idle();
    expect(systems[0]).toContain("主人希望报告三行以内");
    expect(lasts[0]).toContain("小王负责前端");
    expect(store.memory.list({ kinds: ["owner"] }).map((r) => r.abstract)).toContain(
      "主人默认用 kimi",
    );

    herder.ownerMessage("还有吗");
    await herder.idle();
    expect(systems[1]).not.toContain("主人默认用 kimi"); // frozen for the prompt cache

    now += MEMORY_REFRESH_MS;
    herder.ownerMessage("在吗");
    await herder.idle();
    expect(systems[2]).toContain("主人默认用 kimi");
  });
});

describe("Herder review trigger", () => {
  it("queues one review after enough owner messages", async () => {
    const store = Store.open(":memory:");
    const registration = registerFauxProvider();
    faux.push(registration);
    const { host } = fakeHost({ memory: store.memory });
    const herder = new Herder({
      host,
      model: registration.getModel(),
      streamFn: streamSimple,
      sleep: async () => {},
    });
    registration.setResponses(
      Array.from({ length: REVIEW_EVERY_TURNS * 2 }, () => () => fauxAssistantMessage("好。")),
    );
    for (let i = 0; i < REVIEW_EVERY_TURNS * 2; i++) {
      herder.ownerMessage(`消息 ${i}`);
      await herder.idle();
    }
    // The first review is still waiting, so the second batch adds none.
    expect(store.memory.jobs().map((j) => j.kind)).toEqual(["review"]);
    await herder.stop();
  });
});
