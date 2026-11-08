import type {
  ItemOption,
  Locale,
  ReportResult,
  Risk,
  Stage,
  TextTone,
  TextView,
  View,
} from "@agentherd/protocol";
import { DEFAULT_LOCALE } from "@agentherd/protocol";
import { readableMath } from "./math.ts";
import type { CardTexts } from "./texts.ts";
import { CARD_TEXTS } from "./texts.ts";

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
function riskLabel(risk: Risk, t: CardTexts): string {
  return t.risk[risk];
}

/** Break a ``` sequence inside a code block so it cannot close the fence early. */
function escapeCodeFence(text: string): string {
  return text.replaceAll("```", "``\u200B`");
}

/** A card header: title, colored template, and a risk tag. */
function itemHeader(
  title: string,
  risk: Risk,
  template: string,
  t: CardTexts,
): Record<string, unknown> {
  return {
    title: { tag: "plain_text", content: title },
    template,
    text_tag_list: [
      {
        tag: "text_tag",
        text: { tag: "plain_text", content: riskLabel(risk, t) },
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

/** A markdown element; TeX math is written as plain text, which Feishu cards can show. */
function markdown(content: string): Record<string, unknown> {
  return { tag: "markdown", content: readableMath(content) };
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

/** Header template color for a report, driven by how the task ended. */
function reportTemplate(result: ReportResult): string {
  switch (result) {
    case "failed":
      return "red";
    case "blocked":
      return "orange";
    case "done":
      return "green";
    case "stopped":
      return "grey";
  }
}

/** Maximum body length shown before a report body is folded. */
export const FOLD_CHARS = 400;

const REPORT_ICON: Record<ReportResult, string> = {
  done: "✅",
  failed: "❌",
  blocked: "⚠️",
  stopped: "⏹",
};

const TONE: Record<TextTone, { icon: string; template: string }> = {
  progress: { icon: "⏳", template: "blue" },
  alarm: { icon: "⚠️", template: "orange" },
  error: { icon: "❌", template: "red" },
};

/**
 * A text's header (ADR 0036): none for the Herder talking; a task's message gets its name with an
 * icon and colour by tone (blue by default); an error without a task gets a red header.
 */
function textHeader(view: TextView, t: CardTexts): Record<string, unknown> | undefined {
  if (view.taskLabel === undefined && view.tone === undefined) return undefined;
  const tone = TONE[view.tone ?? "progress"];
  const title =
    view.taskLabel !== undefined
      ? `${tone.icon} ${view.taskLabel}`
      : (view.title ?? (view.tone === "error" ? t.errorHeader : tone.icon));
  return { title: { tag: "plain_text", content: title }, template: tone.template };
}

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
export function renderCard(view: View, locale: Locale = DEFAULT_LOCALE): Record<string, unknown> {
  const t = CARD_TEXTS[locale];
  switch (view.kind) {
    case "item": {
      const elements: Record<string, unknown>[] = [markdown(`**${view.title}**`)];
      elements.push(markdown(`\`\`\`\n${escapeCodeFence(view.body)}\n\`\`\``));
      if (view.reason !== undefined) {
        elements.push(markdown(`${t.reasonPrefix}<font color='grey'>${view.reason}</font>`));
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
          t.itemHeader(view.taskLabel),
          view.risk,
          view.final !== undefined ? "grey" : "orange",
          t,
        ),
        elements,
      );
    }
    case "text": {
      const elements: Record<string, unknown>[] = [];
      if (view.text.length <= FOLD_CHARS) {
        elements.push(markdown(view.text));
      } else {
        elements.push(markdown(`${foldBody(view.text)}…`));
        elements.push(collapsiblePanel(t.showAll, view.text));
      }
      if (view.options !== undefined && view.target !== undefined) {
        for (const o of view.options) elements.push(actionRow(view.target, o.action, o.label));
      }
      return makeCard(textHeader(view, t), elements);
    }
    case "board": {
      const header = { title: { tag: "plain_text", content: t.boardHeader }, template: "blue" };
      if (view.rows.length === 0) {
        return makeCard(header, [markdown(t.noTasks)]);
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
          { name: "task", display_name: t.columns.task, data_type: "text", width: "auto" },
          { name: "stage", display_name: t.columns.stage, data_type: "options", width: "120px" },
          { name: "project", display_name: t.columns.project, data_type: "text", width: "auto" },
          { name: "agent", display_name: t.columns.agent, data_type: "text", width: "100px" },
          { name: "report", display_name: t.columns.report, data_type: "lark_md", width: "auto" },
          { name: "updated", display_name: t.columns.updated, data_type: "text", width: "90px" },
        ],
        rows: view.rows.map((row) => ({
          task: row.task,
          stage: [{ text: t.stages[row.stage], color: stageColor(row.stage) }],
          project: row.project,
          agent: row.agent,
          report: readableMath(row.lastReport),
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
        elements.push(collapsiblePanel(t.showAll, view.body));
      }
      if (view.summarized && view.fullReply !== undefined) {
        elements.push(collapsiblePanel(t.fullReply, view.fullReply));
      }
      if (view.automaticDecisions.length > 0) {
        // Folded: the owner sees how many, and opens the list when they care (ADR 0049).
        elements.push(
          collapsiblePanel(
            `${t.automaticDecisions} · ${view.automaticDecisions.length}`,
            view.automaticDecisions.map((decision) => `- ${decision}`).join("\n"),
          ),
        );
      }
      if (view.result !== "done") {
        elements.push(actionRow(view.taskId, "relay", t.relayToTask));
      }
      const header: Record<string, unknown> = {
        title: { tag: "plain_text", content: `${REPORT_ICON[view.result]} ${view.title}` },
        template: reportTemplate(view.result),
      };
      if (view.subtitle !== undefined) {
        header.subtitle = { tag: "plain_text", content: view.subtitle };
      }
      return makeCard(header, elements);
    }
    case "ask": {
      const elements: Record<string, unknown>[] = [markdown(view.text)];
      if (view.final !== undefined) elements.push(markdown(t.askAnswered(view.final)));
      else for (const o of view.options) elements.push(actionRow(view.askId, o.action, o.label));
      return makeCard(
        {
          title: { tag: "plain_text", content: t.askHeader },
          template: view.final !== undefined ? "grey" : "purple",
        },
        elements,
      );
    }
    case "relay": {
      const elements: Record<string, unknown>[] = [];
      if (view.active) {
        elements.push(markdown(t.relayActive(view.taskLabel)));
        elements.push(actionRow(view.taskId, "end-relay", t.endRelay));
      } else {
        elements.push(markdown(t.backToHerder));
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
