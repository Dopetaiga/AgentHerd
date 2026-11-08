import type { BoardView } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import { renderCard } from "../src/card.ts";
import {
  allowDenyItem,
  bodyElements,
  buttonRow,
  makeReport,
  makeRow,
  must,
} from "./card-helpers.ts";

describe("renderCard zh-CN defaults", () => {
  it("renders the risk label in Chinese by default", () => {
    const card = renderCard(allowDenyItem);
    const header = card.header as Record<string, unknown>;
    const tags = header.text_tag_list as Record<string, unknown>[];
    const tag = must(tags[0]);
    const text = tag.text as Record<string, unknown>;
    expect(text.content).toBe("中风险");
  });

  it("renders the board header and stage name in Chinese", () => {
    const view: BoardView = { kind: "board", rows: [makeRow({ stage: "working" })] };
    const card = renderCard(view);
    expect(card.header).toEqual({
      title: { tag: "plain_text", content: "任务看板" },
      template: "blue",
    });
    const table = must(bodyElements(card)[0]);
    const rows = table.rows as Record<string, unknown>[];
    expect(must(rows[0]).stage).toEqual([{ text: "进行中", color: "blue" }]);
  });

  it("renders the report relay button label in Chinese", () => {
    const elements = bodyElements(renderCard(makeReport({ result: "blocked" })));
    expect(must(elements[elements.length - 1])).toEqual(buttonRow("转接到这个任务", "r1", "relay"));
  });

  it("renders relay texts in Chinese", () => {
    const active = bodyElements(
      renderCard({ kind: "relay", taskId: "t1", taskLabel: "Build", active: true }),
    );
    expect(active).toHaveLength(2);
    expect(active[0]).toEqual({
      tag: "markdown",
      content: "正在和 **Build** 对话。直接发的消息都会转给这个任务，发 /end 结束。",
    });
    expect(active[1]).toEqual(buttonRow("结束转接", "t1", "end-relay"));

    expect(
      bodyElements(renderCard({ kind: "relay", taskId: "t1", taskLabel: "Build", active: false })),
    ).toEqual([{ tag: "markdown", content: "已回到主管" }]);
  });
});
