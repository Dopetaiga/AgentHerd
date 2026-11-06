import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/commands.ts";
import { forgetMemory, memoryListText, restoreMemory } from "../src/memory-commands.ts";
import { Store } from "../src/store.ts";
import { coreTexts } from "../src/texts.ts";

const t = coreTexts("zh-CN");

function seeded() {
  const store = Store.open(":memory:");
  const { ids } = store.memory.write(
    [
      { op: "add", kind: "owner", abstract: "回复用中文，先说结论", evidence: "以后都用中文" },
      { op: "add", kind: "person", abstract: "小王负责 pi-desktop 打包" },
    ],
    { actor: "herder", source: "said" },
  );
  return { store, ids };
}

describe("memory commands", () => {
  it("parses the Chinese and English names", () => {
    expect(parseCommand("/记忆")).toEqual({ kind: "memory", query: "" });
    expect(parseCommand("/memory 小王")).toEqual({ kind: "memory", query: "小王" });
    expect(parseCommand("/忘掉 abc123")).toEqual({ kind: "forget", target: "abc123" });
    expect(parseCommand("/restore abc")).toEqual({ kind: "restore", target: "abc" });
    expect(parseCommand("/忘掉").kind).toBe("invalid");
  });

  it("lists by kind with short ids", () => {
    const { store, ids } = seeded();
    const text = memoryListText(store.memory, "", t);
    expect(text).toContain("关于你");
    expect(text).toContain(`${ids[1]?.slice(0, 8)} 小王负责 pi-desktop 打包`);
    expect(memoryListText(store.memory, "天气预报", t)).toBe(t.memoryNoMatch("天气预报"));
  });

  it("forgets by id or words and restores", () => {
    const { store, ids } = seeded();
    expect(forgetMemory(store.memory, "小王", t)).toContain("忘掉了：小王负责");
    expect(store.memory.list({ kinds: ["person"] })).toEqual([]);
    expect(restoreMemory(store.memory, ids[1]?.slice(0, 6) ?? "", t)).toContain("找回了");
    expect(store.memory.list({ kinds: ["person"] })).toHaveLength(1);
    expect(store.memory.lastLog("owner.restored")?.ref).toBe(ids[1]);
  });

  it("asks for an id when several match", () => {
    const { store } = seeded();
    store.memory.write([{ op: "add", kind: "person", abstract: "小王也管发布" }], {
      actor: "herder",
      source: "said",
    });
    expect(forgetMemory(store.memory, "小王", t)).toContain("请用编号");
  });
});
