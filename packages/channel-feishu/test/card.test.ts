import type { ItemView, TextView } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import { renderCard, renderText } from "../src/card.ts";

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
    expect(renderCard(allowDenyItem)).toMatchSnapshot();
  });

  it("renders a final item card", () => {
    expect(renderCard(finalItem)).toMatchSnapshot();
  });

  it("renders a high-risk item card", () => {
    expect(renderCard(highRiskItem)).toMatchSnapshot();
  });

  it("renders a text view", () => {
    expect(renderCard(textView)).toMatchSnapshot();
  });

  it("sets update_multi to true", () => {
    expect(renderCard(allowDenyItem).config).toEqual({ update_multi: true });
  });

  it("gives each button a callback value of {target, action}", () => {
    const json = JSON.stringify(renderCard(allowDenyItem));
    expect(json).toContain('"value":{"target":"item-1","action":"allow"}');
    expect(json).toContain('"value":{"target":"item-1","action":"deny"}');
  });

  it("renders no button for a final card", () => {
    expect(JSON.stringify(renderCard(finalItem))).not.toContain("button");
  });

  it("escapes triple backticks inside the body", () => {
    const view: ItemView = {
      ...allowDenyItem,
      body: "before ``` after",
    };
    const json = JSON.stringify(renderCard(view));
    expect(json).toContain("before ``\u200B` after");
    expect(json).not.toContain("before ``` after");
  });

  it("sets the header template to grey for a final card", () => {
    const card = renderCard(finalItem);
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
