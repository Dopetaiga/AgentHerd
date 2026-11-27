import type { FoundServiceView } from "@agentherd/host/api";
import { describe, expect, it } from "vitest";
import {
  chipNote,
  foundLine,
  foundOrder,
  lookResult,
  offered,
  sourcesText,
} from "../src/renderer/src/found-services";

const base: FoundServiceView = {
  id: "f",
  name: "杰哥",
  sources: ["dsh", "cc-switch"],
  kind: "openai-compatible",
  baseUrl: "https://ai-gw.example",
  api: "anthropic-messages",
  models: ["claude-opus-5-5", "claude-sonnet-5"],
  keyHint: "sk-7…3fec",
};

describe("services found on this computer (ADR 0107)", () => {
  it("says where a service came from and what it serves", () => {
    expect(sourcesText(base.sources)).toBe("DeepSeek Harness、CC Switch");
    expect(foundLine(base)).toBe(
      "https://ai-gw.example · Anthropic 格式 · claude-opus-5-5 等 2 个",
    );
    expect(
      foundLine({ ...base, kind: "builtin", provider: "deepseek", api: undefined, models: [] }),
    ).toBe("deepseek 官方 · 加上后自动读模型");
  });

  it("puts the ones not added yet first", () => {
    const list = foundOrder([
      { ...base, id: "a", name: "A", added: { id: "a", name: "A" } },
      { ...base, id: "b", name: "B" },
    ]);
    expect(list.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("offers only what is not added yet, in small chips", () => {
    const list = [
      { ...base, id: "a", name: "A", added: { id: "a", name: "A" } },
      { ...base, id: "b", name: "B" },
    ];
    expect(offered(list).map((s) => s.id)).toEqual(["b"]);
    expect(chipNote(base)).toBe("claude-opus-5-5 · DSH/CC Switch");
    expect(chipNote({ ...base, models: [], sources: ["env"] })).toBe("环境变量");
  });

  it("says what 探测 found", () => {
    const b = { ...base, id: "b", name: "B" };
    const c = { ...base, id: "c", name: "C" };
    expect(lookResult(new Set(["b"]), [b, c])).toBe("看完了，多了 1 个可以加的");
    expect(lookResult(new Set(["b"]), [b])).toBe("看完了，没有新的（还是这 1 个）");
    expect(lookResult(new Set(), [])).toBe("看完了，没有可以加的");
  });
});
