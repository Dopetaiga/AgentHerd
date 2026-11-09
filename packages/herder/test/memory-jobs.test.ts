import { CASE_JOB, LESSON_JOB, REVIEW_JOB, Store } from "@agentherd/core";
import { describe, expect, it } from "vitest";
import {
  EXPERIENCE_SYSTEM,
  LESSON_SYSTEM,
  MemoryWorker,
  parseJson,
  REVIEW_SYSTEM,
} from "../src/memory-jobs.ts";

/** A memory model that answers each system prompt with the next scripted reply. */
function model(replies: Record<string, string[]>) {
  const asked: { system: string; user: string }[] = [];
  const complete = async (system: string, user: string) => {
    asked.push({ system, user });
    const next = replies[system]?.shift();
    if (next === undefined) throw new Error("unexpected request");
    return next;
  };
  return { asked, complete };
}

function setup(replies: Record<string, string[]>) {
  const store = Store.open(":memory:");
  const m = model(replies);
  const worker = new MemoryWorker({
    memory: store.memory,
    transcript: (id) => store.transcript(id),
    herderTurns: (n) => store.herderTurns(n),
    complete: m.complete,
  });
  return { store, worker, asked: m.asked };
}

const LESSON = JSON.stringify({
  skip: false,
  task_signature: "给 Electron 应用排查打包签名失败",
  lesson: "签名失败先看构建日志，别先重装依赖",
  evidence: "重装依赖白费了时间，日志里直接是证书过期",
});
const SIGNALS = ["the owner prompted it 1 more time(s) after the first"];

describe("parseJson", () => {
  it("reads JSON from a code fence", () => {
    expect(parseJson('好的\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => parseJson("no")).toThrow("no JSON");
  });
});

describe("MemoryWorker", () => {
  it("a task picked for a lesson adds experience and no case (ADR 0054)", async () => {
    const { store, worker, asked } = setup({
      [LESSON_SYSTEM]: [LESSON],
      [EXPERIENCE_SYSTEM]: [
        JSON.stringify({
          action: "add",
          abstract: "签名失败先看构建日志",
          details: "比重装依赖快",
        }),
      ],
    });
    store.addTranscript("t1", "prompt", "打包失败了，看看");
    store.addTranscript("t1", "agent", "签名证书过期，已更新，打包成功");
    store.memory.enqueueJob(LESSON_JOB, {
      taskId: "t1",
      title: "pi-desktop：打包",
      cwd: "/u/pi-desktop",
      why: "done",
      signals: SIGNALS,
    });
    await worker.drain();
    expect(asked[0]?.user).toContain("签名证书过期");
    expect(asked[0]?.user).toContain("Picked because: the owner prompted it");
    expect(store.memory.list({ kinds: ["case"] })).toEqual([]);
    const lessons = store.memory.list({ kinds: ["experience"] });
    expect(lessons.map((r) => [r.abstract, r.scope, r.sourceRef])).toEqual([
      ["签名失败先看构建日志", "project:/u/pi-desktop", "t1"],
    ]);
    expect(store.memory.jobs()[0]?.state).toBe("done");

    // The same task again asks nothing.
    store.memory.enqueueJob(LESSON_JOB, { taskId: "t1", signals: SIGNALS });
    await worker.drain();
    expect(asked).toHaveLength(2);
  });

  it("an update in a second project makes the lesson global", async () => {
    const { store, worker } = setup({});
    const { ids } = store.memory.write(
      [
        {
          op: "add",
          kind: "experience",
          abstract: "打包签名失败先看构建日志",
          scope: "project:/u/a",
        },
      ],
      { actor: "task", source: "task" },
    );
    const id = (ids[0] as string).slice(0, 8);
    store.memory.enqueueJob(LESSON_JOB, { taskId: "t2", cwd: "/u/b", signals: SIGNALS });
    store.addTranscript("t2", "prompt", "打包签名失败");
    store.addTranscript("t2", "agent", "看了构建日志，修好了");
    (worker as unknown as { deps: { complete: unknown } }).deps.complete = model({
      [LESSON_SYSTEM]: [LESSON],
      [EXPERIENCE_SYSTEM]: [
        JSON.stringify({
          action: "update",
          id,
          abstract: "签名失败先看构建日志，两个项目都是这样",
          details: "",
        }),
      ],
    }).complete;
    await worker.drain();
    const lesson = store.memory.list({ kinds: ["experience"] });
    expect(lesson.map((r) => [r.abstract, r.scope])).toEqual([
      ["签名失败先看构建日志，两个项目都是这样", "global"],
    ]);
  });

  it("most picked tasks teach nothing; a bad reply retries later", async () => {
    const { store, worker } = setup({ [LESSON_SYSTEM]: ['{"skip": true}', "not json"] });
    for (const t of ["t1", "t2"]) {
      store.addTranscript(t, "prompt", "hi");
      store.addTranscript(t, "agent", "hello");
      store.memory.enqueueJob(LESSON_JOB, { taskId: t, signals: SIGNALS });
    }
    await worker.drain();
    expect(store.memory.list()).toEqual([]);
    expect(store.memory.jobs().map((j) => j.state)).toEqual(["pending", "done"]);
  });

  it("an old case job from before ADR 0054 asks no model", async () => {
    const { store, worker, asked } = setup({});
    store.addTranscript("t1", "prompt", "找 issue");
    store.addTranscript("t1", "agent", "9 个");
    store.memory.enqueueJob(CASE_JOB, { taskId: "t1", why: "done" });
    await worker.drain();
    expect(asked).toEqual([]);
    expect(store.memory.jobs()[0]?.state).toBe("done");
  });

  it("a review keeps only what passes the memory checks", async () => {
    const { store, worker, asked } = setup({
      [REVIEW_SYSTEM]: [
        JSON.stringify({
          operations: [
            {
              action: "add",
              kind: "owner",
              content: "主人希望报告三行以内",
              evidence: "以后报告三行以内",
            },
            {
              action: "add",
              kind: "owner",
              content: "主人关心 pi-desktop",
              evidence: "看下 pi-desktop",
            },
            { action: "add", kind: "person", content: "小王负责前端", evidence: "小王是我们前端" },
            { action: "add", kind: "project", content: "演示在 /tmp/demo", evidence: "/tmp/demo" },
          ],
        }),
      ],
    });
    store.addHerderTurn("owner", "以后报告三行以内。看下 pi-desktop");
    store.addHerderTurn("herder", "好的，小王是我们前端吗？");
    store.addHerderTurn("owner", "小王是我们前端");
    store.addHerderTurn("answer", "/tmp/demo");
    store.memory.enqueueJob(REVIEW_JOB, { afterId: 0 });
    await worker.drain();
    expect(asked[0]?.user).toContain("[owner tapped] /tmp/demo");
    expect(
      store.memory
        .list()
        .map((r) => r.abstract)
        .sort(),
    ).toEqual(["主人希望报告三行以内", "小王负责前端"]);
    expect(store.memory.lastLog("review.done")?.ref).toBe("4");
    expect(store.memory.logs().filter((l) => l.kind === "review.dropped")).toHaveLength(2);
  });
});
