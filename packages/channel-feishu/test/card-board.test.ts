import type { BoardView, Stage } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import { renderCard } from "../src/card.ts";
import { bodyElements, makeRow, must } from "./card-helpers.ts";

describe("renderCard board", () => {
  it("renders an empty board as one markdown element", () => {
    const card = renderCard({ kind: "board", rows: [] }, "en");
    expect(card.header).toEqual({
      title: { tag: "plain_text", content: "Tasks" },
      template: "blue",
    });
    expect(card.body).toEqual({ elements: [{ tag: "markdown", content: "No tasks yet." }] });
  });

  it("renders the table columns and header style", () => {
    const view: BoardView = { kind: "board", rows: [makeRow(), makeRow({ taskId: "t2" })] };
    const elements = bodyElements(renderCard(view, "en"));
    expect(elements).toHaveLength(1);

    const table = must(elements[0]);
    expect(table.tag).toBe("table");
    expect(table.page_size).toBe(2);
    expect(table.row_height).toBe("low");
    expect(table.freeze_first_column).toBe(true);
    expect(table.header_style).toEqual({
      text_align: "left",
      text_size: "normal",
      background_style: "grey",
      text_color: "default",
      bold: true,
      lines: 1,
    });
    expect(table.columns).toEqual([
      { name: "task", display_name: "Task", data_type: "text", width: "auto" },
      { name: "stage", display_name: "Stage", data_type: "options", width: "120px" },
      { name: "project", display_name: "Project", data_type: "text", width: "auto" },
      { name: "agent", display_name: "Agent", data_type: "text", width: "100px" },
      { name: "report", display_name: "Last report", data_type: "lark_md", width: "auto" },
      { name: "updated", display_name: "Updated", data_type: "text", width: "90px" },
    ]);
  });

  it("maps each row in order with stage color and local-time updated", () => {
    const view: BoardView = {
      kind: "board",
      rows: [
        makeRow({ taskId: "t1", task: "Fix build", stage: "working", project: "core" }),
        makeRow({
          taskId: "t2",
          task: "Ship release",
          stage: "done",
          project: "core",
          agent: "releaser",
          lastReport: "Released",
          updatedAt: "2024-01-02T10:00:00.000Z",
        }),
      ],
    };
    const table = must(bodyElements(renderCard(view, "en"))[0]);
    const rows = table.rows as Record<string, unknown>[];

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      task: "Fix build",
      stage: [{ text: "working", color: "blue" }],
      project: "core",
      agent: "builder",
      report: "Running tests",
      updated: expect.stringMatching(/^\d{2}:\d{2}$/),
    });
    expect(rows[1]).toEqual({
      task: "Ship release",
      stage: [{ text: "done", color: "green" }],
      project: "core",
      agent: "releaser",
      report: "Released",
      updated: expect.stringMatching(/^\d{2}:\d{2}$/),
    });
    expect(rows.map((row) => row.task)).toEqual(["Fix build", "Ship release"]);
  });

  it("derives updated from updatedAt in local time", () => {
    const iso = "2024-06-01T03:04:00.000Z";
    const view: BoardView = { kind: "board", rows: [makeRow({ updatedAt: iso })] };
    const table = must(bodyElements(renderCard(view, "en"))[0]);
    const rows = table.rows as Record<string, unknown>[];
    const date = new Date(iso);
    expect(must(rows[0]).updated).toBe(
      `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
    );
  });

  it("maps every stage to its color", () => {
    const stages: Stage[] = ["queued", "working", "needs-owner", "stuck", "done", "failed"];
    const colors = ["neutral", "blue", "orange", "red", "green", "red"];
    const view: BoardView = {
      kind: "board",
      rows: stages.map((stage, index) => makeRow({ taskId: `t${index}`, stage })),
    };
    const table = must(bodyElements(renderCard(view, "en"))[0]);
    const rows = table.rows as Record<string, unknown>[];
    expect(rows.map((row) => row.stage)).toEqual(
      stages.map((stage, index) => [{ text: stage, color: colors[index] }]),
    );
  });

  it("caps page_size at 10", () => {
    const view: BoardView = {
      kind: "board",
      rows: Array.from({ length: 12 }, (_, index) =>
        makeRow({ taskId: `t${index}`, task: `task ${index}` }),
      ),
    };
    const table = must(bodyElements(renderCard(view, "en"))[0]);
    expect(table.page_size).toBe(10);
  });
});
