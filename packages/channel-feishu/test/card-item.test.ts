import type { ItemView } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import { FOLD_CHARS, renderCard, renderText } from "../src/card.ts";
import { allowDenyItem, bodyElements, finalItem, highRiskItem, textView } from "./card-helpers.ts";

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
