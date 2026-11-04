import type {
  BoardRow,
  BoardView,
  ItemView,
  ReportView,
  Stage,
  TextView,
} from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import { FOLD_CHARS, renderCard, renderText } from "../src/card.ts";
import { parseCardAction } from "../src/inbound.ts";

const allowDenyItem: ItemView = {
  kind: "item",
  itemId: "item-1",
  taskLabel: "Fix the build",
  title: "Run `npm install`?",
  body: "Install dependencies in /repo",
  risk: "medium",
  options: [
    { action: "allow", label: "Allow" },
    { action: "deny", label: "Deny" },
  ],
  reason: "Seen in 3 sessions",
};

const finalItem: ItemView = {
  ...allowDenyItem,
  final: "Allowed by you",
};

const highRiskItem: ItemView = {
  ...allowDenyItem,
  itemId: "item-2",
  risk: "high",
  options: [{ action: "escalate", label: "Escalate" }],
};

const textView: TextView = {
  kind: "text",
  taskLabel: "Build",
  text: "hello world",
};

describe("renderCard", () => {
  it("renders an allow/deny item card", () => {
    expect(renderCard(allowDenyItem, "en")).toMatchSnapshot();
  });

  it("renders a final item card", () => {
    expect(renderCard(finalItem, "en")).toMatchSnapshot();
  });

  it("renders a high-risk item card", () => {
    expect(renderCard(highRiskItem, "en")).toMatchSnapshot();
  });

  it("renders a text view", () => {
    expect(renderCard(textView, "en")).toMatchSnapshot();
  });

  it("sets update_multi to true", () => {
    expect(renderCard(allowDenyItem, "en").config).toEqual({ update_multi: true });
  });

  it("gives each button a callback value of {target, action}", () => {
    const json = JSON.stringify(renderCard(allowDenyItem, "en"));
    expect(json).toContain('"value":{"target":"item-1","action":"allow"}');
    expect(json).toContain('"value":{"target":"item-1","action":"deny"}');
  });

  it("renders no button for a final card", () => {
    expect(JSON.stringify(renderCard(finalItem, "en"))).not.toContain("button");
  });

  it("escapes triple backticks inside the body", () => {
    const view: ItemView = {
      ...allowDenyItem,
      body: "before ``` after",
    };
    const json = JSON.stringify(renderCard(view, "en"));
    expect(json).toContain("before ``\u200B` after");
    expect(json).not.toContain("before ``` after");
  });

  it("sets the header template to grey for a final card", () => {
    const card = renderCard(finalItem, "en");
    expect(card.header).toMatchObject({ template: "grey" });
  });
});

describe("renderText", () => {
  it("prefixes the text with the task label", () => {
    expect(renderText(textView)).toBe("[Build] hello world");
  });

  it("returns the text as-is without a label", () => {
    expect(renderText({ kind: "text", text: "plain" })).toBe("plain");
  });
});

function bodyElements(card: Record<string, unknown>): Record<string, unknown>[] {
  return (card.body as { elements: Record<string, unknown>[] }).elements;
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

function makeRow(overrides: Partial<BoardRow> = {}): BoardRow {
  return {
    taskId: "t1",
    task: "Fix the build",
    stage: "working",
    project: "agentherd",
    agent: "builder",
    lastReport: "Running tests",
    updatedAt: "2024-01-02T09:05:07.000Z",
    ...overrides,
  };
}

function makeReport(overrides: Partial<ReportView> = {}): ReportView {
  return {
    kind: "report",
    taskId: "r1",
    result: "done",
    title: "Daily summary",
    body: "short body",
    summarized: false,
    automaticDecisions: [],
    ...overrides,
  };
}

function buttonRow(label: string, target: string, action: string): Record<string, unknown> {
  return {
    tag: "column_set",
    columns: [
      {
        tag: "column",
        width: "auto",
        elements: [
          {
            tag: "button",
            text: { tag: "plain_text", content: label },
            type: "default",
            behaviors: [{ type: "callback", value: { target, action } }],
          },
        ],
      },
    ],
  };
}

/** Pull the {target, action} callback value out of a one-button row. */
function buttonValue(row: Record<string, unknown>): Record<string, unknown> {
  const columns = row.columns as Record<string, unknown>[];
  const column = must(columns[0]);
  const elements = column.elements as Record<string, unknown>[];
  const button = must(elements[0]);
  const behaviors = button.behaviors as Record<string, unknown>[];
  return must(behaviors[0]).value as Record<string, unknown>;
}

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

describe("renderCard report", () => {
  it("uses green for result done", () => {
    expect(renderCard(makeReport({ result: "done" }), "en").header).toMatchObject({
      template: "green",
      title: { tag: "plain_text", content: "Daily summary" },
    });
  });

  it("uses red for result failed", () => {
    expect(renderCard(makeReport({ result: "failed" }), "en").header).toMatchObject({
      template: "red",
    });
  });

  it("uses orange for result blocked", () => {
    expect(renderCard(makeReport({ result: "blocked" }), "en").header).toMatchObject({
      template: "orange",
    });
  });

  it("uses grey for result stopped", () => {
    expect(renderCard(makeReport({ result: "stopped" }), "en").header).toMatchObject({
      template: "grey",
    });
  });

  it("shows a short body as a single markdown element plus the relay button row", () => {
    expect(bodyElements(renderCard(makeReport({ body: "hello" }), "en"))).toEqual([
      { tag: "markdown", content: "hello" },
      buttonRow("Relay to this task", "r1", "relay"),
    ]);
  });

  it("folds a long body with no newline and adds a Show all panel", () => {
    const body = "x".repeat(FOLD_CHARS + 50);
    const elements = bodyElements(renderCard(makeReport({ body }), "en"));
    expect(elements).toHaveLength(3);
    expect(elements[0]).toEqual({ tag: "markdown", content: `${"x".repeat(FOLD_CHARS)}…` });
    expect(elements[1]).toEqual({
      tag: "collapsible_panel",
      expanded: false,
      header: { title: { tag: "markdown", content: "Show all" } },
      elements: [{ tag: "markdown", content: body }],
    });
    expect(elements[2]).toEqual(buttonRow("Relay to this task", "r1", "relay"));
  });

  it("cuts at the last newline after position 200", () => {
    const head = "a".repeat(300);
    const body = `${head}\n${"b".repeat(FOLD_CHARS)}`;
    const elements = bodyElements(renderCard(makeReport({ body }), "en"));
    expect(elements[0]).toEqual({ tag: "markdown", content: `${head}…` });
    expect(must(elements[1]).elements).toEqual([{ tag: "markdown", content: body }]);
  });

  it("hard-cuts when the last newline is not after position 200", () => {
    const head = "a".repeat(100);
    const body = `${head}\n${"b".repeat(FOLD_CHARS + 50)}`;
    const elements = bodyElements(renderCard(makeReport({ body }), "en"));
    expect(elements[0]).toEqual({ tag: "markdown", content: `${body.slice(0, FOLD_CHARS)}…` });
  });

  it("adds a Full reply panel when summarized with a full reply", () => {
    const elements = bodyElements(
      renderCard(makeReport({ summarized: true, fullReply: "the whole reply" }), "en"),
    );
    expect(elements).toHaveLength(3);
    expect(elements[1]).toEqual({
      tag: "collapsible_panel",
      expanded: false,
      header: { title: { tag: "markdown", content: "Full reply" } },
      elements: [{ tag: "markdown", content: "the whole reply" }],
    });
    expect(elements[2]).toEqual(buttonRow("Relay to this task", "r1", "relay"));
  });

  it("omits the Full reply panel when not summarized", () => {
    expect(bodyElements(renderCard(makeReport({ fullReply: "the whole reply" }), "en"))).toEqual([
      { tag: "markdown", content: "short body" },
      buttonRow("Relay to this task", "r1", "relay"),
    ]);
  });

  it("renders automatic decisions as a bullet list", () => {
    const elements = bodyElements(
      renderCard(makeReport({ automaticDecisions: ["Allow lint", "Deny deploy"] }), "en"),
    );
    expect(elements).toHaveLength(3);
    expect(elements[1]).toEqual({
      tag: "markdown",
      content: "**Automatic decisions**\n- Allow lint\n- Deny deploy",
    });
    expect(elements[2]).toEqual(buttonRow("Relay to this task", "r1", "relay"));
  });

  it("omits the decisions block when empty", () => {
    expect(bodyElements(renderCard(makeReport({ automaticDecisions: [] }), "en"))).toEqual([
      { tag: "markdown", content: "short body" },
      buttonRow("Relay to this task", "r1", "relay"),
    ]);
  });

  it("round-trips the Relay to this task button through parseCardAction", () => {
    const elements = bodyElements(renderCard(makeReport(), "en"));
    const value = buttonValue(must(elements[elements.length - 1]));
    expect(value).toEqual({ target: "r1", action: "relay" });

    const payload = {
      event: {
        operator: { open_id: "ou_owner000" },
        action: { value },
      },
    };
    expect(parseCardAction(payload)).toEqual({
      kind: "action",
      target: "r1",
      action: "relay",
      from: "ou_owner000",
    });
  });
});

describe("renderCard relay", () => {
  it("shows the talking content and an End relay button when active", () => {
    const elements = bodyElements(
      renderCard({ kind: "relay", taskId: "t1", taskLabel: "Build", active: true }, "en"),
    );
    expect(elements).toHaveLength(2);
    expect(elements[0]).toEqual({
      tag: "markdown",
      content: "Now talking to **Build**. Plain messages go to this task. /end to stop.",
    });
    expect(elements[1]).toEqual(buttonRow("End relay", "t1", "end-relay"));
  });

  it("shows Back to the Herder with no button when inactive", () => {
    expect(
      bodyElements(
        renderCard({ kind: "relay", taskId: "t1", taskLabel: "Build", active: false }, "en"),
      ),
    ).toEqual([{ tag: "markdown", content: "Back to the Herder" }]);
  });

  it("round-trips the End relay button through parseCardAction", () => {
    const elements = bodyElements(
      renderCard({ kind: "relay", taskId: "t1", taskLabel: "Build", active: true }, "en"),
    );
    const value = buttonValue(must(elements[1]));
    expect(value).toEqual({ target: "t1", action: "end-relay" });

    const payload = {
      event: {
        operator: { open_id: "ou_owner000" },
        action: { value },
      },
    };
    expect(parseCardAction(payload)).toEqual({
      kind: "action",
      target: "t1",
      action: "end-relay",
      from: "ou_owner000",
    });
  });
});

describe("renderCard text folding", () => {
  it("shows a long text folded with a Show all panel", () => {
    const text = "x".repeat(FOLD_CHARS + 30);
    const elements = bodyElements(renderCard({ kind: "text", text }, "en"));
    expect(elements).toHaveLength(2);
    expect(elements[0]).toEqual({ tag: "markdown", content: `${"x".repeat(FOLD_CHARS)}…` });
    expect(elements[1]).toEqual({
      tag: "collapsible_panel",
      expanded: false,
      header: { title: { tag: "markdown", content: "Show all" } },
      elements: [{ tag: "markdown", content: text }],
    });
  });

  it("keeps a text at or under FOLD_CHARS as a single markdown element", () => {
    const text = "x".repeat(FOLD_CHARS);
    expect(bodyElements(renderCard({ kind: "text", text }, "en"))).toEqual([
      { tag: "markdown", content: text },
    ]);
  });
});

describe("FOLD_CHARS", () => {
  it("is 600", () => {
    expect(FOLD_CHARS).toBe(600);
  });
});

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
    const elements = bodyElements(renderCard(makeReport()));
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
