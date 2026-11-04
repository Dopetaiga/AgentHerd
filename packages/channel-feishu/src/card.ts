import type { ItemOption, Risk, TextView, View } from "@agentherd/protocol";

/** Feishu card header template color for an item's risk level. */
function riskTemplate(risk: Risk): string {
  switch (risk) {
    case "low":
      return "green";
    case "medium":
      return "orange";
    case "high":
      return "red";
  }
}

/** User-facing tag text for an item's risk level. */
function riskLabel(risk: Risk): string {
  switch (risk) {
    case "low":
      return "Low risk";
    case "medium":
      return "Medium risk";
    case "high":
      return "High risk";
  }
}

/** Break a ``` sequence inside a code block so it cannot close the fence early. */
function escapeCodeFence(text: string): string {
  return text.replaceAll("```", "``\u200B`");
}

/** A card header: title, colored template, and a risk tag. */
function itemHeader(title: string, risk: Risk, template: string): Record<string, unknown> {
  return {
    title: { tag: "plain_text", content: title },
    template,
    text_tag_list: [
      {
        tag: "text_tag",
        text: { tag: "plain_text", content: riskLabel(risk) },
        color: riskTemplate(risk),
      },
    ],
  };
}

/** A callback button for one item option. */
function itemButton(itemId: string, option: ItemOption): Record<string, unknown> {
  return {
    tag: "button",
    text: { tag: "plain_text", content: option.label },
    type:
      option.action === "allow"
        ? "primary_filled"
        : option.action === "deny"
          ? "danger"
          : "default",
    behaviors: [{ type: "callback", value: { target: itemId, action: option.action } }],
  };
}

function markdown(content: string): Record<string, unknown> {
  return { tag: "markdown", content };
}

function makeCard(
  header: Record<string, unknown> | undefined,
  elements: Record<string, unknown>[],
): Record<string, unknown> {
  const card: Record<string, unknown> = {
    schema: "2.0",
    config: { update_multi: true },
    body: { elements },
  };
  if (header !== undefined) {
    card.header = header;
  }
  return card;
}

/** Render a channel-neutral view as Feishu Card JSON 2.0. */
export function renderCard(view: View): Record<string, unknown> {
  switch (view.kind) {
    case "item": {
      const elements: Record<string, unknown>[] = [];
      if (view.taskLabel !== undefined) {
        elements.push(markdown(`**${view.taskLabel}**`));
      }
      elements.push(markdown(`\`\`\`\n${escapeCodeFence(view.body)}\n\`\`\``));
      if (view.reason !== undefined) {
        elements.push(markdown(`Reason: <font color='grey'>${view.reason}</font>`));
      }
      if (view.final !== undefined) {
        elements.push(markdown(`**${view.final}**`));
      } else {
        elements.push({
          tag: "column_set",
          columns: view.options.map((option) => ({
            tag: "column",
            width: "auto",
            elements: [itemButton(view.itemId, option)],
          })),
        });
      }
      return makeCard(
        itemHeader(
          view.title,
          view.risk,
          view.final !== undefined ? "grey" : riskTemplate(view.risk),
        ),
        elements,
      );
    }
    case "text": {
      const elements: Record<string, unknown>[] = [];
      if (view.taskLabel !== undefined) {
        elements.push(markdown(`**${view.taskLabel}**`));
      }
      elements.push(markdown(view.text));
      return makeCard(undefined, elements);
    }
    case "board": {
      const lines = view.rows.map((row) => `${row.task} — ${row.stage} — ${row.lastReport}`);
      return makeCard(undefined, [markdown(lines.join("\n"))]);
    }
    case "report": {
      const elements: Record<string, unknown>[] = [markdown(view.body)];
      if (view.automaticDecisions.length > 0) {
        elements.push(
          markdown(view.automaticDecisions.map((decision) => `- ${decision}`).join("\n")),
        );
      }
      return makeCard({ title: { tag: "plain_text", content: view.title } }, elements);
    }
    case "relay": {
      const content = view.active ? `Now talking to ${view.taskLabel}` : "Back to the Herder";
      return makeCard(undefined, [markdown(content)]);
    }
  }
}

/** Render a text view as a plain line, e.g. "[label] text". */
export function renderText(view: TextView): string {
  if (view.taskLabel !== undefined) {
    return `[${view.taskLabel}] ${view.text}`;
  }
  return view.text;
}
