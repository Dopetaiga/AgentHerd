// Each kind of message has its own look (ADR 0036).
import { describe, expect, it } from "vitest";
import { renderCard } from "../src/card.ts";
import { allowDenyItem, makeReport } from "./card-helpers.ts";

const header = (c: Record<string, unknown>) =>
  c.header as { title: { content: string }; template: string; subtitle?: { content: string } };

describe("message cards by kind", () => {
  it("the Herder talking has no header", () => {
    expect(renderCard({ kind: "text", text: "好的" }, "zh-CN").header).toBeUndefined();
  });

  it("a Herder question is purple", () => {
    const h = header(
      renderCard(
        { kind: "ask", askId: "a", text: "哪个？", options: [{ action: "0", label: "x" }] },
        "zh-CN",
      ),
    );
    expect(h).toMatchObject({ template: "purple", title: { content: "主管问你" } });
  });

  it("a task's message is blue, an alarm orange, an error red", () => {
    const tone = (t?: "progress" | "alarm" | "error") =>
      header(
        renderCard(
          { kind: "text", text: "x", taskLabel: "修构建", ...(t === undefined ? {} : { tone: t }) },
          "zh-CN",
        ),
      );
    expect(tone()).toMatchObject({ template: "blue", title: { content: "⏳ 修构建" } });
    expect(tone("alarm").template).toBe("orange");
    expect(tone("error").template).toBe("red");
    const herderError = header(renderCard({ kind: "text", text: "x", tone: "error" }, "zh-CN"));
    expect(herderError).toMatchObject({ template: "red", title: { content: "❌ 主管出错了" } });
  });

  it("a report has an icon by result and a subtitle", () => {
    const h = header(
      renderCard(makeReport({ result: "failed", subtitle: "失败 · app · Pi · 3m" }), "zh-CN"),
    );
    expect(h.title.content.startsWith("❌ ")).toBe(true);
    expect(h.template).toBe("red");
    expect(h.subtitle?.content).toBe("失败 · app · Pi · 3m");
  });

  it("an approval is orange and names its task", () => {
    const h = header(renderCard({ ...allowDenyItem, taskLabel: "修构建", risk: "low" }, "zh-CN"));
    expect(h).toMatchObject({ template: "orange", title: { content: "⚠️ 等你确认 · 修构建" } });
  });
});
