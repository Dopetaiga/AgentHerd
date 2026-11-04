// Task reports: the completion report, watchdog alarms, and the stage on the board.

import type { AgentConnection } from "@agentherd/acp-client";
import { type Following, firstLine, type HerdContext } from "./herd-context.ts";
import {
  REPORT_MAX_CHARS,
  reportBody,
  reportView,
  type SummaryAnswer,
  summaryPrompt,
} from "./report.ts";
import { stageOf } from "./tasks.ts";
import type { Alarm } from "./watchdog.ts";

export function setReport(ctx: HerdContext, f: Following, text: string): void {
  f.task.lastReport = text;
  f.task.updatedAt = ctx.clock.now().toISOString();
  ctx.board.changed();
}

/** Recomputes the stage of a task from its session; updates the board if it changed. */
export function restage(ctx: HerdContext, f: Following): void {
  const row = ctx.registry.get(f.task.id);
  if (row === undefined) return;
  if (row.state === "error") f.failed = true;
  const stage = stageOf({
    session: f.failed ? "error" : row.state,
    openItems: row.state === "waiting-approval" ? 1 : 0,
    alarm: f.alarm,
    finished: f.finished,
  });
  if (stage === f.task.stage) return;
  f.task.stage = stage;
  f.task.updatedAt = ctx.clock.now().toISOString();
  ctx.board.changed();
}

/** Asks the session for its own short summary (docs/spec/04-herder.md "Completion report"). */
export async function askSummary(
  ctx: HerdContext,
  connection: AgentConnection,
  agentSessionId: string,
  f: Following,
): Promise<SummaryAnswer> {
  f.turn = { text: "", toolCalls: 0 };
  const max = ctx.opts.reportMaxChars ?? REPORT_MAX_CHARS;
  await connection.prompt(agentSessionId, summaryPrompt(max, ctx.texts));
  return { text: f.turn.text, toolCalls: f.turn.toolCalls };
}

/** Sends the completion report once per task. */
export async function sendReport(
  ctx: HerdContext,
  f: Following,
  reply: string,
  ask: (() => Promise<SummaryAnswer>) | null,
): Promise<void> {
  const max = ctx.opts.reportMaxChars ?? REPORT_MAX_CHARS;
  const body = await reportBody(
    reply,
    ask ?? (() => Promise.reject(new Error("no summary turn"))),
    max,
    ctx.texts.noReply,
  );
  restage(ctx, f);
  const view = reportView(f.task, body, ctx.clock.now(), ctx.texts);
  try {
    await ctx.opts.channel.send(view);
    ctx.store.audit("report.sent", { taskId: f.task.id, summarized: body.summarized });
  } catch (error) {
    ctx.store.audit("report.error", { taskId: f.task.id, message: (error as Error).message });
  }
  setReport(ctx, f, ctx.texts.reported(firstLine(body.body)));
  ctx.herder()?.event({
    kind: "task-reported",
    taskId: f.task.id,
    title: f.task.title,
    text: body.body,
  });
}

export async function onAlarm(ctx: HerdContext, alarm: Alarm): Promise<void> {
  const f = ctx.following.get(alarm.sessionId);
  if (f === undefined) return;
  f.alarm = true;
  ctx.store.audit("watchdog.alarm", { ...alarm });
  setReport(ctx, f, ctx.texts.watchdog(alarm.detail));
  try {
    await ctx.opts.channel.send({
      kind: "text",
      taskLabel: f.task.title,
      text: ctx.texts.watchdog(alarm.detail),
    });
  } catch (error) {
    ctx.store.audit("watchdog.error", { message: (error as Error).message });
  }
  ctx.herder()?.event({
    kind: "watchdog",
    taskId: f.task.id,
    title: f.task.title,
    text: alarm.detail,
  });
}
