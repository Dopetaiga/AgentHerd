// Shared fixtures and card-walking helpers for the card-*.test.ts files.

import type { BoardRow, ItemView, ReportView, TextView } from "@agentherd/protocol";

export const allowDenyItem: ItemView = {
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

export const finalItem: ItemView = {
  ...allowDenyItem,
  final: "Allowed by you",
};

export const highRiskItem: ItemView = {
  ...allowDenyItem,
  itemId: "item-2",
  risk: "high",
  options: [{ action: "escalate", label: "Escalate" }],
};

export const textView: TextView = {
  kind: "text",
  taskLabel: "Build",
  text: "hello world",
};

export function bodyElements(card: Record<string, unknown>): Record<string, unknown>[] {
  return (card.body as { elements: Record<string, unknown>[] }).elements;
}

export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

export function makeRow(overrides: Partial<BoardRow> = {}): BoardRow {
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

export function makeReport(overrides: Partial<ReportView> = {}): ReportView {
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

export function buttonRow(label: string, target: string, action: string): Record<string, unknown> {
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
export function buttonValue(row: Record<string, unknown>): Record<string, unknown> {
  const columns = row.columns as Record<string, unknown>[];
  const column = must(columns[0]);
  const elements = column.elements as Record<string, unknown>[];
  const button = must(elements[0]);
  const behaviors = button.behaviors as Record<string, unknown>[];
  return must(behaviors[0]).value as Record<string, unknown>;
}
