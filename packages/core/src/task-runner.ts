// Task lifecycle: start an agent, run prompts one turn at a time, end the task.

import { randomUUID } from "node:crypto";
import { type AgentConnection, startAgent } from "@agentherd/acp-client";
import {
  type Following,
  firstLine,
  type HerdContext,
  type RunResult,
  say,
  type TaskOps,
} from "./herd-context.ts";
import { onPermission } from "./permission.ts";
import type { Relay } from "./relay.ts";
import { REPLY_HINT_CHARS, replyHint } from "./report.ts";
import { askSummary, sendReport, setReport } from "./task-report.ts";
import { projectName, taskTitle } from "./tasks.ts";

export const SESSION_IDLE_MINUTES = 60;

export class TaskRunner {
  private readonly ctx: HerdContext;
  private readonly relay: Relay;
  private readonly ops: TaskOps;

  constructor(ctx: HerdContext, relay: Relay, ops: TaskOps) {
    this.ctx = ctx;
    this.relay = relay;
    this.ops = ops;
  }

  /**
   * Starts an agent and a session for a task and sends the owner's text as the first prompt.
   * Returns once the session exists; `turn` settles when the first turn ends.
   */
  async startTask(
    profileId: string,
    cwd: string,
    ownerText: string,
    prompt: string = ownerText,
    model?: string,
  ): Promise<{ taskId: string; turn: Promise<RunResult> }> {
    const { ctx } = this;
    const found = ctx.opts.profiles.find((p) => p.id === profileId);
    if (found === undefined) throw new Error(`unknown agent profile "${profileId}"`);
    let profile = found;
    if (model !== undefined) {
      if (ctx.opts.agentModels === undefined) throw new Error("no model list to choose from");
      const env = ctx.opts.agentModels.envFor(profileId, model);
      profile = { ...found, env: { ...found.env, ...env } };
    }
    const sessionId = randomUUID();
    const now = ctx.clock.now().toISOString();
    const f: Following = {
      task: {
        id: sessionId,
        title: taskTitle(ownerText),
        project: projectName(cwd),
        agent: model === undefined ? profile.name : `${profile.name} · ${model}`,
        ...(model === undefined ? {} : { model }),
        stage: "queued",
        lastReport: ctx.texts.starting,
        startedAt: now,
        updatedAt: now,
        automaticDecisions: [],
      },
      profile,
      cwd,
      alarm: false,
      finished: false,
      failed: false,
      ended: false,
      turn: { text: "", toolCalls: 0 },
      offs: [],
      queue: [],
      busy: false,
      hinted: false,
    };
    ctx.following.set(sessionId, f);
    ctx.registry.add(sessionId, profile.id, cwd);
    ctx.board.changed();

    try {
      const connection = await startAgent(profile, { cwd });
      f.connection = connection;
      f.agentSessionId = await connection.newSession(cwd);
    } catch (error) {
      const message = (error as Error).message;
      setReport(ctx, f, ctx.texts.couldNotStart(message));
      ctx.registry.set(sessionId, "error");
      await sendReport(ctx, f, ctx.texts.couldNotStartBody(message), null);
      await this.ops.endTask(sessionId, ctx.texts.agentCouldNotStart);
      throw error;
    }
    ctx.store.audit("session.started", {
      sessionId,
      profileId,
      cwd,
      ...(model === undefined ? {} : { model }),
      agentSessionId: f.agentSessionId,
    });
    ctx.watchdog.track(sessionId);
    this.listen(f, f.connection, f.agentSessionId);
    return { taskId: sessionId, turn: this.ops.promptTask(sessionId, prompt) };
  }

  /** Sends a prompt to an open task. Queued while a turn runs; settles when its turn ends. */
  promptTask(taskId: string, text: string): Promise<RunResult> {
    const f = this.ctx.following.get(taskId);
    if (f === undefined || f.ended) return Promise.reject(new Error(`task ${taskId} is not open`));
    const done = new Promise<RunResult>((resolve, reject) => {
      f.queue.push({ text, resolve, reject });
    });
    void this.pump(f);
    return done;
  }

  /** Cancels the current turn of a task, then sends the text as the next prompt. */
  async interruptTask(taskId: string, text: string): Promise<RunResult> {
    const f = this.ctx.following.get(taskId);
    if (f === undefined || f.ended) throw new Error(`task ${taskId} is not open`);
    const next = this.ops.promptTask(taskId, text);
    if (f.busy && f.connection !== undefined && f.agentSessionId !== undefined) {
      await f.connection.cancel(f.agentSessionId);
    }
    return next;
  }

  /** Cancels the current turn of a task, if one is running. */
  async cancelTurn(taskId: string): Promise<void> {
    const f = this.ctx.following.get(taskId);
    if (f === undefined || f.ended) throw new Error(`task ${taskId} is not open`);
    if (f.busy && f.connection !== undefined && f.agentSessionId !== undefined) {
      await f.connection.cancel(f.agentSessionId);
    }
  }

  /** Closes the agent of a task. The task stays on the board. */
  async endTask(taskId: string, why: string): Promise<void> {
    const { ctx } = this;
    const f = ctx.following.get(taskId);
    if (f === undefined || f.ended) return;
    f.ended = true;
    f.endedWhy = why;
    f.idleTimer?.cancel();
    ctx.watchdog.untrack(taskId);
    for (const off of f.offs) off();
    f.offs = [];
    for (const queued of f.queue.splice(0)) queued.reject(new Error(`the task ended: ${why}`));
    await ctx.inbox.expireSession(taskId, why);
    await f.connection?.close();
    ctx.registry.set(taskId, "ended");
    ctx.store.audit("task.ended", { taskId, why });
    if (this.relay.stored()?.taskId === taskId) {
      await this.relay.end("the task ended");
    }
    await ctx.board.flush();
  }

  private listen(f: Following, connection: AgentConnection, agentSessionId: string): void {
    const { ctx } = this;
    const sessionId = f.task.id;
    f.offs = [
      connection.on("permission", (request) => {
        if (request.sessionId !== agentSessionId) return;
        ctx.watchdog.event(sessionId);
        void onPermission(ctx, sessionId, f.profile, f.cwd, request).catch((error: Error) => {
          // Never leave the agent without an answer it can act on: cancel, never allow.
          request.respond({ kind: "cancelled" });
          ctx.store.audit("permission.error", { sessionId, message: error.message });
        });
      }),
      connection.on("update", (u) => {
        if (u.sessionId !== agentSessionId) return;
        if (u.type === "message") f.turn.text += u.text ?? "";
        if (u.type === "tool_call" && u.toolCall !== undefined) {
          f.turn.toolCalls += 1;
          const key = `${u.toolCall.title}\u0000${JSON.stringify(u.toolCall.rawInput ?? u.toolCall.command ?? "")}`;
          ctx.watchdog.toolCall(sessionId, key, u.toolCall.command ?? u.toolCall.title);
        } else {
          ctx.watchdog.event(sessionId);
        }
        const state = ctx.registry.get(sessionId)?.state;
        if (state !== "waiting-approval" && f.busy) ctx.registry.set(sessionId, "working");
      }),
      connection.on("exit", (e) => {
        ctx.store.audit("session.exited", { sessionId, code: e.code, signal: e.signal });
        if (f.busy) {
          ctx.watchdog.exited(sessionId, ctx.texts.exited(String(e.code ?? e.signal)));
        }
        if (!f.ended) ctx.registry.set(sessionId, e.code === 0 ? "ended" : "error");
        if (!f.busy && !f.ended) void this.ops.endTask(sessionId, ctx.texts.agentExited);
      }),
    ];
  }

  /** Runs queued prompts one turn at a time. */
  private async pump(f: Following): Promise<void> {
    if (f.busy) return;
    const next = f.queue.shift();
    if (next === undefined) return;
    f.busy = true;
    f.idleTimer?.cancel();
    try {
      next.resolve(await this.runTurn(f, next.text));
    } catch (error) {
      next.reject(error as Error);
    } finally {
      f.busy = false;
    }
    if (f.ended) return;
    if (f.queue.length > 0) {
      void this.pump(f);
      return;
    }
    const minutes = this.ctx.opts.sessionIdleMinutes ?? SESSION_IDLE_MINUTES;
    f.idleTimer = this.ctx.clock.after(minutes * 60_000, () => {
      void this.ops.endTask(f.task.id, `no prompt for ${minutes} minutes`);
    });
  }

  private async runTurn(f: Following, text: string): Promise<RunResult> {
    const { ctx } = this;
    const sessionId = f.task.id;
    const { connection, agentSessionId } = f;
    if (connection === undefined || agentSessionId === undefined) {
      throw new Error(`task ${sessionId} has no session`);
    }
    f.turn = { text: "", toolCalls: 0 };
    f.finished = false;
    f.alarm = false;
    let prompt = text;
    if (!f.hinted) {
      f.hinted = true;
      prompt = `${replyHint(ctx.opts.replyHintChars ?? REPLY_HINT_CHARS, ctx.texts)}\n\n${text}`;
    }
    ctx.registry.set(sessionId, "working");
    ctx.watchdog.turnStarted(sessionId);
    try {
      const { stopReason } = await connection.prompt(agentSessionId, prompt);
      ctx.watchdog.turnEnded(sessionId);
      f.finished = stopReason === "end_turn";
      ctx.store.audit("turn.ended", { sessionId, stopReason });
      ctx.registry.set(sessionId, "idle");
      await ctx.inbox.expireSession(sessionId, ctx.texts.turnEnded);
      const reply = f.turn.text;
      if (this.relay.current()?.taskId === sessionId) {
        setReport(ctx, f, ctx.texts.relayed(firstLine(reply)));
        await say(ctx, reply.trim() === "" ? ctx.texts.noReply : reply, f.task.title);
        ctx.store.audit("relay.reply", { taskId: sessionId, stopReason });
      } else {
        await sendReport(ctx, f, reply, () => askSummary(ctx, connection, agentSessionId, f));
      }
      return { sessionId, stopReason };
    } catch (error) {
      // Ending a task closes its agent, which fails the running turn; report why it ended, not
      // the agent's exit.
      const message = f.endedWhy ?? (error as Error).message;
      ctx.watchdog.turnEnded(sessionId);
      if (ctx.registry.get(sessionId)?.state !== "ended") ctx.registry.set(sessionId, "error");
      await sendReport(ctx, f, ctx.texts.failedBody(message), null);
      await this.ops.endTask(sessionId, ctx.texts.turnFailed);
      throw error;
    }
  }
}
