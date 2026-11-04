import type { ItemOption, Risk, Stage, TextView, View } from "@agentherd/protocol";

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

/** A one-button row for a relay/end-relay action with a {target, action} value. */
function actionRow(target: string, action: string, label: string): Record<string, unknown> {
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

/** Feishu option color for a board row's stage. */
function stageColor(stage: Stage): string {
  switch (stage) {
    case "queued":
      return "neutral";
    case "working":
      return "blue";
    case "needs-owner":
      return "orange";
    case "stuck":
      return "red";
    case "done":
      return "green";
    case "failed":
      return "red";
  }
}

/** Local-time HH:MM from an ISO timestamp, zero-padded. */
function clock(iso: string): string {
  const date = new Date(iso);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Header template color for a report title. */
function reportTemplate(title: string): string {
  if (title.startsWith("Failed")) return "red";
  if (title.startsWith("Blocked")) return "orange";
  return "green";
}

/** Maximum body length shown before a report body is folded. */
export const FOLD_CHARS = 600;

/** Shorten a long body, cutting at the last newline after position 200 when possible. */
function foldBody(body: string): string {
  const prefix = body.slice(0, FOLD_CHARS);
  const lastNewline = prefix.lastIndexOf("\n");
  if (lastNewline > 200) {
    return body.slice(0, lastNewline);
  }
  return prefix;
}

/** A folded panel (e.g. "Show all") wrapping a markdown element. */
function collapsiblePanel(title: string, content: string): Record<string, unknown> {
  return {
    tag: "collapsible_panel",
    expanded: false,
    header: { title: markdown(title) },
    elements: [markdown(content)],
  };
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
      if (view.text.length <= FOLD_CHARS) {
        elements.push(markdown(view.text));
      } else {
        elements.push(markdown(`${foldBody(view.text)}…`));
        elements.push(collapsiblePanel("Show all", view.text));
      }
      return makeCard(undefined, elements);
    }
    case "board": {
      const header = { title: { tag: "plain_text", content: "Tasks" }, template: "blue" };
      if (view.rows.length === 0) {
        return makeCard(header, [markdown("No tasks yet.")]);
      }
      const table: Record<string, unknown> = {
        tag: "table",
        page_size: Math.min(10, view.rows.length),
        row_height: "low",
        freeze_first_column: true,
        header_style: {
          text_align: "left",
          text_size: "normal",
          background_style: "grey",
          text_color: "default",
          bold: true,
          lines: 1,
        },
        columns: [
          { name: "task", display_name: "Task", data_type: "text", width: "auto" },
          { name: "stage", display_name: "Stage", data_type: "options", width: "120px" },
          { name: "project", display_name: "Project", data_type: "text", width: "auto" },
          { name: "agent", display_name: "Agent", data_type: "text", width: "100px" },
          { name: "report", display_name: "Last report", data_type: "lark_md", width: "auto" },
          { name: "updated", display_name: "Updated", data_type: "text", width: "90px" },
        ],
        rows: view.rows.map((row) => ({
          task: row.task,
          stage: [{ text: row.stage, color: stageColor(row.stage) }],
          project: row.project,
          agent: row.agent,
          report: row.lastReport,
          updated: clock(row.updatedAt),
        })),
      };
      return makeCard(header, [table]);
    }
    case "report": {
      const elements: Record<string, unknown>[] = [];
      if (view.body.length <= FOLD_CHARS) {
        elements.push(markdown(view.body));
      } else {
        elements.push(markdown(`${foldBody(view.body)}…`));
        elements.push(collapsiblePanel("Show all", view.body));
      }
      if (view.summarized && view.fullReply !== undefined) {
        elements.push(collapsiblePanel("Full reply", view.fullReply));
      }
      if (view.automaticDecisions.length > 0) {
        elements.push(
          markdown(
            `**Automatic decisions**\n${view.automaticDecisions
              .map((decision) => `- ${decision}`)
              .join("\n")}`,
          ),
        );
      }
      elements.push(actionRow(view.taskId, "relay", "Relay to this task"));
      return makeCard(
        {
          title: { tag: "plain_text", content: view.title },
          template: reportTemplate(view.title),
        },
        elements,
      );
    }
    case "relay": {
      const elements: Record<string, unknown>[] = [];
      if (view.active) {
        elements.push(
          markdown(
            `Now talking to **${view.taskLabel}**. Plain messages go to this task. /end to stop.`,
          ),
        );
        elements.push(actionRow(view.taskId, "end-relay", "End relay"));
      } else {
        elements.push(markdown("Back to the Herder"));
      }
      return makeCard(undefined, elements);
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
