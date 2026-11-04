import { describe, expect, it } from "vitest";
import { FOLD_CHARS, renderCard } from "../src/card.ts";
import { parseCardAction } from "../src/inbound.ts";
import { bodyElements, buttonRow, buttonValue, makeReport, must } from "./card-helpers.ts";

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
