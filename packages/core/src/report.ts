// Completion reports (docs/spec/04-herder.md §2 "Completion report", ADR 0019). The body is the
// agent's own words: its final reply, or its own summary when the reply is long. AgentHerd adds
// only the title and the list of automatic decisions.

import type { ReportResult, ReportView, Stage } from "@agentherd/protocol";
import type { Task } from "./tasks.ts";
import { CORE_TEXTS, type CoreTexts } from "./texts.ts";

/** Default `reportMaxChars`. */
export const REPORT_MAX_CHARS = 600;

/** Default `replyHintChars`. */
export const REPLY_HINT_CHARS = 300;

/** The extra prompt for a long final reply. Labeled, so the agent knows who asks. */
export function summaryPrompt(maxChars: number, texts: CoreTexts = CORE_TEXTS.en): string {
  return texts.summaryPrompt(maxChars);
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

/**
 * Chooses the report body by size. The summary turn is asked at most once; if it fails, calls
 * tools, is empty, or is still too long, the body is the original reply (the channel folds it).
 * @param finalReply The agent's last message of the task, verbatim.
 * @param askSummary Sends `summaryPrompt()` to the same session and returns its answer.
 */
export async function reportBody(
  finalReply: string,
  askSummary: () => Promise<SummaryAnswer>,
  maxChars: number = REPORT_MAX_CHARS,
  noReply: string = CORE_TEXTS.en.noReply,
): Promise<ReportBody> {
  const reply = finalReply.trim();
  if (reply.length <= maxChars) return { body: reply === "" ? noReply : reply, summarized: false };
  try {
    const answer = await askSummary();
    const text = answer.text.trim();
    if (answer.toolCalls === 0 && text !== "" && text.length <= maxChars) {
      return { body: text, summarized: true, fullReply: reply };
    }
  } catch {
    // The summary turn failed (agent exited or rejected the prompt): fall back to the reply.
  }
  return { body: reply, summarized: false };
}

const RESULT: Record<Stage, ReportResult> = {
  done: "done",
  failed: "failed",
  stuck: "blocked",
  "needs-owner": "blocked",
  working: "stopped",
  queued: "stopped",
};

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
  const result = RESULT[task.stage];
  const view: ReportView = {
    kind: "report",
    taskId: task.id,
    result,
    title: `${texts.result[result]}${texts.titleSep}${task.title} · ${task.project} · ${task.agent} · ${duration}`,
    body: body.body,
    summarized: body.summarized,
    automaticDecisions: [...task.automaticDecisions],
  };
  if (body.fullReply !== undefined) view.fullReply = body.fullReply;
  return view;
}
