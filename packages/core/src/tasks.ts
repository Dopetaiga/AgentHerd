// Tasks and their stages (docs/spec/04-herder.md §2 "Stages"). A task is one agent session that
// AgentHerd started for the owner. Stages are computed by code, never by a model.

import { basename } from "node:path";
import type { ReportState, SessionState, Stage } from "@agentherd/protocol";

/** Longest task title shown on the board and in labels. */
export const TITLE_MAX_CHARS = 60;

export interface Task {
  /** Same as the AgentHerd session id. */
  id: string;
  title: string;
  project: string;
  agent: string;
  /** "service/model" when the task runs with a model from the owner's list. */
  model?: string;
  stage: Stage;
  /** Last report or event in one line, for the board. */
  lastReport: string;
  startedAt: string;
  updatedAt: string;
  /** Lines like "Allowed by rule r1: npm test", for the completion report. */
  automaticDecisions: string[];
}

/**
 * The task title: the first non-empty line of the owner's prompt, cut to `TITLE_MAX_CHARS`.
 * @param prompt The owner's words, verbatim.
 */
export function taskTitle(prompt: string): string {
  const line =
    prompt
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "") ?? "(empty task)";
  return line.length <= TITLE_MAX_CHARS ? line : `${line.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

/** The project name shown for a working directory. */
export function projectName(cwd: string): string {
  return basename(cwd) || cwd;
}

export interface StageInput {
  session: SessionState;
  /** Items of the session that wait for the owner. */
  openItems: number;
  /** A watchdog alarm is active. */
  alarm: boolean;
  /** State of the last `herd_report`, if any. */
  report?: ReportState | undefined;
  /** The turn ended normally (stop reason `end_turn`). */
  finished: boolean;
}

/**
 * Computes a task's stage. Order: open items, final report states, failures, finished turns,
 * alarms, then the session state.
 * @returns The stage shown on the board.
 */
export function stageOf(input: StageInput): Stage {
  if (input.openItems > 0) return "needs-owner";
  switch (input.report) {
    case "ready":
    case "dropped":
      return "done";
    case "failed":
      return "failed";
    case "blocked":
      return "stuck";
    case "waiting":
      return "needs-owner";
    default:
      break;
  }
  if (input.session === "error") return "failed";
  // A turn that ended normally is done, even after an earlier watchdog alarm.
  if (input.finished) return "done";
  if (input.alarm || input.session === "looping") return "stuck";
  if (input.session === "ended" || input.session === "idle") return "failed";
  if (input.session === "starting") return "queued";
  return "working";
}

const ORDER: Record<Stage, number> = {
  "needs-owner": 0,
  stuck: 1,
  working: 2,
  queued: 3,
  failed: 4,
  done: 5,
};

/**
 * Board order: tasks that need the owner first, then by stage, then newest update first.
 * @returns A new array.
 */
export function sortForBoard(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(
    (a, b) => ORDER[a.stage] - ORDER[b.stage] || b.updatedAt.localeCompare(a.updatedAt),
  );
}
