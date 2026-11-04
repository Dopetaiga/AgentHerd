import { describe, expect, it } from "vitest";
import { renderCard } from "../src/card.ts";
import { parseCardAction } from "../src/inbound.ts";
import { bodyElements, buttonRow, buttonValue, must } from "./card-helpers.ts";

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
