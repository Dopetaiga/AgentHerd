import { type Embedder, Store } from "@agentherd/core";
import { describe, expect, it } from "vitest";
import { lessonsText, pastLessons } from "../src/memory.ts";
import { MemoryWorker } from "../src/memory-jobs.ts";

const task = { actor: "task", source: "task" } as const;

/** Vectors from a fixed list of topics: texts mentioning the same topic word point the same way. */
const TOPICS = ["签名", "issue", "测试"];
function fakeEmbedder(ready = true): Embedder & { calls: number } {
  const e = {
    model: "fake",
    calls: 0,
    async embed(texts: readonly string[]) {
      e.calls++;
      if (!ready) return undefined;
      return texts.map((t) => {
        const v = Float32Array.from(TOPICS.map((w) => (t.includes(w) ? 1 : 0)));
        if (v.every((x) => x === 0)) v[0] = 0.01;
        return v;
      });
    },
  };
  return e;
}

function seeded() {
  const store = Store.open(":memory:");
  store.memory.write(
    [
      {
        op: "add",
        kind: "case",
        abstract: "pi-desktop：打包签名失败，换证书后修好",
        scope: "global",
      },
      { op: "add", kind: "experience", abstract: "梳理 issue 时先按标签筛", scope: "global" },
      { op: "add", kind: "case", abstract: "AgentHerd：补测试", scope: "global" },
    ],
    task,
  );
  return store;
}

describe("memory vectors", () => {
  it("the worker fills vectors for entries that have none", async () => {
    const store = seeded();
    const embedder = fakeEmbedder();
    const worker = new MemoryWorker({
      memory: store.memory,
      transcript: () => [],
      herderTurns: () => [],
      embedder,
    });
    await worker.drain();
    expect(store.memory.missingVectors("fake")).toEqual([]);
    expect(store.memory.vectors("fake")).toHaveLength(3);
  });

  it("hybrid search finds entries by meaning when no keyword matches", async () => {
    const store = seeded();
    const embedder = fakeEmbedder();
    await new MemoryWorker({
      memory: store.memory,
      transcript: () => [],
      herderTurns: () => [],
      embedder,
    }).fillVectors();
    // "签名" is a 2-character word; the vector still points at the signing case.
    const hits = await store.memory.searchHybrid("应用签名", embedder, { limit: 1 });
    expect(hits[0]?.abstract).toContain("打包签名");
  });

  it("falls back to keywords while the vector model is not ready", async () => {
    const store = seeded();
    const hits = await store.memory.searchHybrid("补测试", fakeEmbedder(false));
    expect(hits.map((h) => h.abstract)).toEqual(["AgentHerd：补测试"]);
  });
});

describe("pastLessons", () => {
  it("keeps what the ranking model picks", async () => {
    const store = seeded();
    const embedder = fakeEmbedder();
    const all = store.memory.list({ kinds: ["case", "experience"] });
    const signing = all.find((r) => r.abstract.includes("签名"));
    const picked = await pastLessons(store.memory, "帮我修打包签名", embedder, async () =>
      JSON.stringify({ ids: [signing?.id.slice(0, 8)] }),
    );
    expect(picked.map((r) => r.abstract)).toEqual(["pi-desktop：打包签名失败，换证书后修好"]);
    expect(lessonsText(picked)).toContain("过去类似任务的记录");
  });

  it("keeps the search order when the ranking model fails", async () => {
    const store = seeded();
    const picked = await pastLessons(store.memory, "补测试", undefined, async () => {
      throw new Error("timeout");
    });
    expect(picked.map((r) => r.abstract)).toEqual(["AgentHerd：补测试"]);
  });

  it("gives nothing when the model says none apply", async () => {
    const store = seeded();
    const picked = await pastLessons(store.memory, "补测试", undefined, async () => '{"ids": []}');
    expect(picked).toEqual([]);
    expect(lessonsText(picked)).toBe("");
  });
});
