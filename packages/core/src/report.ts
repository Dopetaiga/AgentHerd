// Completion reports (docs/spec/04-herder.md §2 "Completion report", ADR 0019, ADR 0049). The
// body is the agent's own words, at most OWNER_WORDS_MAX: its herd_report summary, its final
// reply, or its own summary when the reply is long. AgentHerd adds only the title and the list of
// automatic decisions; the full reply stays one tap away.

import type { ReportResult, ReportView, Stage } from "@agentherd/protocol";
import { cutWords, fitsOwner, OWNER_WORDS_MAX } from "./owner-text.ts";
import type { Task } from "./tasks.ts";
import { CORE_TEXTS, type CoreTexts } from "./texts.ts";

/** Default `reportMaxWords`. */
export const REPORT_MAX_WORDS = OWNER_WORDS_MAX;

/** Default `replyHintChars`. */
export const REPLY_HINT_CHARS = 300;

/** The extra prompt for a long final reply. Labeled, so the agent knows who asks. */
export function summaryPrompt(maxWords: number, texts: CoreTexts = CORE_TEXTS.en): string {
  return texts.summaryPrompt(maxWords);
}

/** The note added before the owner's words in the first prompt of a session. */
export function replyHint(hintChars: number, texts: CoreTexts = CORE_TEXTS.en): string {
  return texts.replyHint(hintChars);
}

/** Answer of the summary turn. */
export interface SummaryAnswer {
  text: string;
  /** Tool calls the agent made during the summary turn. */
  toolCalls: number;
}

export interface ReportBody {
  body: string;
  summarized: boolean;
  fullReply?: string;
}

export interface ReportBodyOptions {
  /** Words in the body; default REPORT_MAX_WORDS. */
  maxWords?: number;
  noReply?: string;
  /** The agent's herd_report summary of this turn (not a progress one). */
  summary?: string;
}

/**
 * Chooses the report body, first that fits in `maxWords` (ADR 0049): the agent's herd_report
 * summary, its reply, its answer to one summary turn, else the reply cut short. Whenever the body
 * is not the whole reply, the reply is kept as `fullReply`.
 * @param finalReply The agent's last message of the task, verbatim.
 * @param askSummary Sends `summaryPrompt()` to the same session and returns its answer.
 */
export async function reportBody(
  finalReply: string,
  askSummary: () => Promise<SummaryAnswer>,
  opts: ReportBodyOptions = {},
): Promise<ReportBody> {
  const max = opts.maxWords ?? REPORT_MAX_WORDS;
  const reply = finalReply.trim();
  const own = opts.summary?.trim() ?? "";
  if (own !== "" && fitsOwner(own, max)) {
    return reply === "" || reply === own
      ? { body: own, summarized: false }
      : { body: own, summarized: true, fullReply: reply };
  }
  if (fitsOwner(reply, max)) {
    return {
      body: reply === "" ? (opts.noReply ?? CORE_TEXTS.en.noReply) : reply,
      summarized: false,
    };
  }
  try {
    const answer = await askSummary();
    const text = answer.text.trim();
    if (answer.toolCalls === 0 && text !== "" && fitsOwner(text, max)) {
      return { body: text, summarized: true, fullReply: reply };
    }
  } catch {
    // The summary turn failed (agent exited or rejected the prompt): cut the reply.
  }
  return { body: cutWords(reply, max), summarized: true, fullReply: reply };
}

const RESULT: Record<Stage, ReportResult> = {
  done: "done",
  failed: "failed",
  stuck: "blocked",
  "needs-owner": "blocked",
  working: "stopped",
  queued: "stopped",
};

/** How a task at this stage ended, for the report card's color. */
export function reportResult(stage: Stage): ReportResult {
  return RESULT[stage];
}

/** "1h 5m", "12m", "40s". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * Builds the report card for a finished task.
 * @param now End time of the task.
 */
export function reportView(
  task: Task,
  body: ReportBody,
  now: Date,
  texts: CoreTexts = CORE_TEXTS.en,
): ReportView {
  const duration = formatDuration(now.getTime() - new Date(task.startedAt).getTime());
  const result = reportResult(task.stage);
  const view: ReportView = {
    kind: "report",
    taskId: task.id,
    result,
    title: task.title,
    subtitle: `${texts.result[result]} · ${task.project} · ${task.agent} · ${duration}`,
    body: body.body,
    summarized: body.summarized,
    automaticDecisions: [...task.automaticDecisions],
  };
  if (body.fullReply !== undefined) {
    view.fullReply = body.fullReply;
    // "Pi · deepseek/deepseek-flash" → "Pi": the card says whose words they are (ADR 0054).
    const by = task.agent.split(" · ")[0]?.trim();
    if (by !== undefined && by !== "") view.fullReplyBy = by;
  }
  return view;
}
