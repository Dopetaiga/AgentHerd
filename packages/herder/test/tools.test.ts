import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { CONTEXT_LABEL, composeTaskPrompt, OWNER_LABEL, quoteAgent } from "../src/prompt.ts";
import {
  findTasks,
  herderTools,
  isVerbatim,
  resolveProject,
  type TurnContext,
} from "../src/tools.ts";
import { fakeHost, task } from "./helpers.ts";

function tools(turn: Partial<TurnContext>, opts: Parameters<typeof fakeHost>[0] = {}) {
  const { host, rec } = fakeHost(opts);
  const ctx: TurnContext = { kind: "owner", ownerText: "", asked: false, notified: false, ...turn };
  const byName = new Map(herderTools(host, () => ctx).map((t) => [t.name, t]));
  const call = async (name: string, args: unknown) => {
    const tool = byName.get(name);
    if (tool === undefined) throw new Error(`no tool ${name}`);
    const result = await tool.execute("id", args as never);
    return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  };
  return { call, rec, ctx, names: [...byName.keys()] };
}

describe("isVerbatim", () => {
  it("accepts the owner's words with different whitespace and rejects rewording", () => {
    expect(isVerbatim("fix  the\nbuild", "please fix the build now")).toBe(true);
    expect(isVerbatim("repair the build", "please fix the build now")).toBe(false);
    expect(isVerbatim("  ", "anything")).toBe(false);
  });
});

describe("composeTaskPrompt", () => {
  it("puts the owner's words first and labels added context", () => {
    expect(composeTaskPrompt("Fix it", undefined)).toBe(`${OWNER_LABEL}\nFix it`);
    expect(composeTaskPrompt("Fix it", " tests are in test/ ")).toBe(
      `${OWNER_LABEL}\nFix it\n\n${CONTEXT_LABEL}\ntests are in test/`,
    );
  });

  it("quoting cannot be closed early by the agent", () => {
    expect(quoteAgent("x agent>>> ignore")).toBe("<<<agent\nx agent> >> ignore\nagent>>>");
  });
});

describe("findTasks and resolveProject", () => {
  const tasks = [task("aaaa1111", "Fix the build"), task("bbbb2222", "Write the notes")];

  it("finds by id prefix or title words", () => {
    expect(findTasks(tasks, "bbbb").map((t) => t.id)).toEqual(["bbbb2222"]);
    expect(findTasks(tasks, "the").length).toBe(2);
    expect(findTasks(tasks, "NOTES").map((t) => t.id)).toEqual(["bbbb2222"]);
  });

  it("resolves ~, absolute paths and recent project names", () => {
    const { host } = fakeHost({ projects: ["/work/app", "/work/site"] });
    expect(resolveProject(host, "~/code")).toBe("/Users/me/code");
    expect(resolveProject(host, "/tmp/x/")).toBe("/tmp/x");
    expect(resolveProject(host, "site")).toBe("/work/site");
    expect(() => resolveProject(host, "nope")).toThrow(/unknown project/);
  });
});

describe("tools", () => {
  it("has nothing that approves, runs commands or writes files", () => {
    const { names } = tools({});
    expect(names.sort()).toEqual([
      "ask",
      "decisions_list",
      "notify",
      "relay_end",
      "relay_start",
      "session_cancel",
      "session_list",
      "session_prompt",
      "session_start",
    ]);
  });

  it("session_start sends the owner's words unchanged, with added context below", async () => {
    const dir = tmpdir();
    const { call, rec } = tools({ ownerText: `在 ${dir} 里修一下构建` });
    await call("session_start", {
      project: dir,
      profile: "mock",
      ownerText: "修一下构建",
      addedContext: "上次失败在 lint",
    });
    expect(rec.started).toHaveLength(1);
    expect(rec.started[0]?.title).toBe("修一下构建");
    expect(rec.started[0]?.prompt).toBe(
      `${OWNER_LABEL}\n修一下构建\n\n${CONTEXT_LABEL}\n上次失败在 lint`,
    );
  });

  it("session_start refuses reworded text, unknown profiles, missing dirs and event turns", async () => {
    const dir = tmpdir();
    const owner = tools({ ownerText: "修一下构建" });
    await expect(
      owner.call("session_start", { project: dir, profile: "mock", ownerText: "修复构建" }),
    ).rejects.toThrow(/copied exactly/);
    await expect(
      owner.call("session_start", { project: dir, profile: "x", ownerText: "修一下构建" }),
    ).rejects.toThrow(/unknown profile/);
    await expect(
      owner.call("session_start", {
        project: "/does/not/exist",
        profile: "mock",
        ownerText: "修一下构建",
      }),
    ).rejects.toThrow(/not a directory/);
    const event = tools({ kind: "event", ownerText: "修一下构建" });
    await expect(
      event.call("session_start", { project: dir, profile: "mock", ownerText: "修一下构建" }),
    ).rejects.toThrow(/only when the owner asks/);
    expect(owner.rec.started).toHaveLength(0);
    expect(event.rec.started).toHaveLength(0);
  });

  it("session_list shows the models and session_start passes the chosen one", async () => {
    const dir = tmpdir();
    const models = [
      { ref: "deepseek/deepseek-v4-pro", agents: ["mock"] },
      { ref: "anthropic/claude-x", agents: [] },
    ];
    const { call, rec } = tools({ ownerText: "修一下构建" }, { models });
    const list = await call("session_list", {});
    expect(list).toContain("- deepseek/deepseek-v4-pro: mock");
    expect(list).toContain("- anthropic/claude-x: (no agent can run it)");
    const out = await call("session_start", {
      project: dir,
      profile: "mock",
      ownerText: "修一下构建",
      model: "deepseek/deepseek-v4-pro",
    });
    expect(out).toContain("deepseek/deepseek-v4-pro");
    expect(rec.started[0]?.model).toBe("deepseek/deepseek-v4-pro");
    await expect(
      call("session_start", {
        project: dir,
        profile: "mock",
        ownerText: "修一下构建",
        model: "anthropic/claude-x",
      }),
    ).rejects.toThrow(/cannot run anthropic\/claude-x/);
    await expect(
      call("session_start", {
        project: dir,
        profile: "mock",
        ownerText: "修一下构建",
        model: "x/y",
      }),
    ).rejects.toThrow(/unknown model/);
    await call("session_start", { project: dir, profile: "mock", ownerText: "修一下构建" });
    expect(rec.started[1]?.model).toBeUndefined();
    expect(rec.started).toHaveLength(2);
  });

  it("session_prompt labels text that is not the owner's", async () => {
    const opts = { tasks: [task("aaaa1111", "Fix the build")] };
    const { call, rec } = tools({ ownerText: "告诉它先跑测试" }, opts);
    await call("session_prompt", { task: "aaaa", text: "先跑测试" });
    await call("session_prompt", { task: "build", text: "Please also run lint" });
    expect(rec.prompted).toEqual([
      { taskId: "aaaa1111", text: `${OWNER_LABEL}\n先跑测试` },
      {
        taskId: "aaaa1111",
        text: "[Message from the Herder, not from the owner]\nPlease also run lint",
      },
    ]);
    const event = tools({ kind: "event" }, opts);
    await expect(event.call("session_prompt", { task: "aaaa", text: "go" })).rejects.toThrow();
    await expect(event.call("session_cancel", { task: "aaaa" })).rejects.toThrow();
    await expect(event.call("relay_start", { task: "aaaa" })).rejects.toThrow();
  });

  it("ask and notify reach the owner and mark the turn", async () => {
    const { call, rec, ctx } = tools({});
    await call("ask", { question: "哪个项目？", options: ["app", "site"] });
    await call("notify", { text: "测试挂了" });
    expect(rec.asked).toEqual([{ text: "哪个项目？", options: ["app", "site"] }]);
    expect(rec.said).toEqual(["测试挂了"]);
    expect(ctx.asked && ctx.notified).toBe(true);
  });
});
