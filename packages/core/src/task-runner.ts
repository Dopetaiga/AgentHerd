// Task lifecycle: start an agent, run prompts one turn at a time, end the task.

import { randomUUID } from "node:crypto";
import { type AgentConnection, startAgent } from "@agentherd/acp-client";
import type { AgentProfile } from "@agentherd/protocol";
import {
  type Following,
  firstLine,
  type HerdContext,
  type RunResult,
  say,
  type TaskOps,
} from "./herd-context.ts";
import type { OwnerImage } from "./herder-port.ts";
import { CASE_JOB } from "./memory-store.ts";
import { onPermission } from "./permission.ts";
import type { Relay } from "./relay.ts";
import { REPLY_HINT_CHARS, replyHint } from "./report.ts";
import { askSummary, flushReply, sendReport, setReport } from "./task-report.ts";
import { projectName, taskTitle } from "./tasks.ts";
import type { CoreTexts } from "./texts.ts";

export const SESSION_IDLE_MINUTES = 60;
/** At most this many models are tried for one task before it fails. */
export const MAX_MODEL_SWITCHES = 3;

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
    images: OwnerImage[] = [],
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
      await f.connection?.close().catch(() => {});
      delete f.connection;
      if (await this.switchModel(f, message)) {
        this.started(f, model);
        return { taskId: sessionId, turn: this.ops.promptTask(sessionId, prompt, images) };
      }
      setReport(ctx, f, ctx.texts.couldNotStart(message));
      ctx.registry.set(sessionId, "error");
      await sendReport(ctx, f, ctx.texts.couldNotStartBody(message), null);
      await this.ops.endTask(sessionId, ctx.texts.agentCouldNotStart);
      throw error;
    }
    this.listen(f, f.connection, f.agentSessionId);
    this.started(f, model);
    return { taskId: sessionId, turn: this.ops.promptTask(sessionId, prompt, images) };
  }

  private started(f: Following, asked: string | undefined): void {
    this.ctx.store.audit("session.started", {
      sessionId: f.task.id,
      profileId: f.profile.id,
      cwd: f.cwd,
      ...(asked === undefined ? {} : { model: f.task.model ?? asked }),
      agentSessionId: f.agentSessionId,
    });
    this.ctx.watchdog.track(f.task.id);
  }

  /** Gives a task a new name on the board and in later reports. */
  renameTask(taskId: string, name: string): void {
    const f = this.ctx.following.get(taskId);
    if (f === undefined) throw new Error(`unknown task ${taskId}`);
    f.task.title = taskTitle(name);
    f.task.updatedAt = this.ctx.clock.now().toISOString();
    this.ctx.board.changed();
  }

  /** Sends a prompt to an open task. Queued while a turn runs; settles when its turn ends. */
  promptTask(taskId: string, text: string, images: OwnerImage[] = []): Promise<RunResult> {
    const f = this.ctx.following.get(taskId);
    if (f === undefined || f.ended) return Promise.reject(new Error(`task ${taskId} is not open`));
    const done = new Promise<RunResult>((resolve, reject) => {
      f.queue.push({ text, images, resolve, reject });
    });
    void this.pump(f);
    return done;
  }

  /** Cancels the current turn of a task, then sends the text as the next prompt. */
  async interruptTask(taskId: string, text: string, images?: OwnerImage[]): Promise<RunResult> {
    const f = this.ctx.following.get(taskId);
    if (f === undefined || f.ended) throw new Error(`task ${taskId} is not open`);
    const next = this.ops.promptTask(taskId, text, images);
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
    // A case for the Herder's memory is written later from the conversation (ADR 0038).
    if (ctx.store.transcript(taskId).length >= 2) {
      ctx.store.memory.enqueueJob(CASE_JOB, {
        taskId,
        title: f.task.title,
        cwd: f.cwd,
        agent: f.task.agent,
        failed: f.failed,
        why,
      });
    }
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
        if (u.type === "message") {
          f.turn.text += u.text ?? "";
          f.pending = (f.pending ?? "") + (u.text ?? "");
        }
        if (u.type === "tool_call_update" && u.toolCallId !== undefined && u.status !== undefined) {
          ctx.store.setToolStatus(sessionId, u.toolCallId, u.status);
        }
        if (u.type === "tool_call" && u.toolCall !== undefined) {
          f.turn.toolCalls += 1;
          flushReply(ctx, f);
          ctx.store.addTranscript(sessionId, "tool", u.toolCall.command ?? u.toolCall.title, {
            id: u.toolCallId ?? "",
            ...(u.status === undefined ? {} : { status: u.status }),
          });
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
      next.resolve(await this.runTurn(f, next.text, next.images));
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

  /**
   * When the task's model broke its first turn (or its agent did not start) before any text or
   * tool call, restarts on the next agent and model that answers (ADR 0030, 0031). False when the
   * task keeps failing.
   */
  private async switchModel(f: Following, why: string): Promise<boolean> {
    const { ctx } = this;
    const models = ctx.opts.agentModels;
    const failed = f.task.model;
    if (models?.next === undefined || failed === undefined || f.endedWhy !== undefined)
      return false;
    if ((f.turnsEnded ?? 0) > 0 || f.turn.text.trim() !== "" || f.turn.toolCalls > 0) return false;
    const tried = f.triedModels ?? [];
    if (!tried.includes(failed)) tried.push(failed);
    f.triedModels = tried;
    f.switches = (f.switches ?? 0) + 1;
    if (f.switches > MAX_MODEL_SWITCHES) return false;
    const fromLabel = f.task.agent;
    let ref: string;
    let profile: AgentProfile;
    try {
      const next = await models.next(f.profile.id, failed, tried);
      if (next === undefined) return false;
      const base = ctx.opts.profiles.find((p) => p.id === next.profileId);
      if (base === undefined) return false;
      ref = next.model;
      profile = { ...base, env: { ...base.env, ...models.envFor(base.id, ref) } };
    } catch {
      return false;
    }
    for (const off of f.offs) off();
    f.offs = [];
    const old = f.connection;
    delete f.connection;
    await old?.close();
    try {
      const connection = await startAgent(profile, { cwd: f.cwd });
      f.connection = connection;
      f.agentSessionId = await connection.newSession(f.cwd);
    } catch (error) {
      ctx.store.audit("task.model-switch-failed", {
        taskId: f.task.id,
        to: ref,
        message: (error as Error).message,
      });
      return false;
    }
    f.profile = profile;
    f.failed = false;
    f.task.model = ref;
    f.task.agent = `${profile.name} · ${ref}`;
    this.listen(f, f.connection, f.agentSessionId);
    const short = why.length > 200 ? `${why.slice(0, 200)}…` : why;
    ctx.store.audit("task.model-switched", {
      taskId: f.task.id,
      from: fromLabel,
      to: f.task.agent,
      why: short,
    });
    ctx.store.addTranscript(
      f.task.id,
      "note",
      ctx.texts.modelSwitched(fromLabel, f.task.agent, short),
    );
    await say(ctx, ctx.texts.modelSwitched(fromLabel, f.task.agent, short), f.task.title, "alarm");
    ctx.board.changed();
    return true;
  }

  private async runTurn(f: Following, text: string, images: OwnerImage[]): Promise<RunResult> {
    const { ctx } = this;
    const sessionId = f.task.id;
    const { connection, agentSessionId } = f;
    if (connection === undefined || agentSessionId === undefined) {
      throw new Error(`task ${sessionId} has no session`);
    }
    f.turn = { text: "", toolCalls: 0 };
    f.pending = "";
    ctx.store.addTranscript(sessionId, "prompt", withImagePaths(text, images, ctx.texts));
    f.finished = false;
    f.alarm = false;
    // An agent that takes no images gets where they are saved instead.
    let prompt = connection.acceptsImages ? text : withImagePaths(text, images, ctx.texts);
    // Every prompt carries the length hint (ADR 0036); follow-ups were long without it.
    prompt = `${replyHint(ctx.opts.replyHintChars ?? REPLY_HINT_CHARS, ctx.texts)}\n\n${prompt}`;
    ctx.registry.set(sessionId, "working");
    ctx.watchdog.turnStarted(sessionId);
    try {
      const { stopReason } = await connection.prompt(
        agentSessionId,
        prompt,
        images.map((i) => ({ data: i.data, mimeType: i.mimeType })),
      );
      ctx.watchdog.turnEnded(sessionId);
      f.finished = stopReason === "end_turn";
      f.turnsEnded = (f.turnsEnded ?? 0) + 1;
      flushReply(ctx, f);
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
      flushReply(ctx, f);
      ctx.store.addTranscript(sessionId, "note", message);
      if (await this.switchModel(f, message)) return this.runTurn(f, text, images);
      if (ctx.registry.get(sessionId)?.state !== "ended") ctx.registry.set(sessionId, "error");
      await sendReport(ctx, f, ctx.texts.failedBody(message), null);
      await this.ops.endTask(sessionId, ctx.texts.turnFailed);
      throw error;
    }
  }
}

/** The text with one line per image, naming the file it is saved in. */
export function withImagePaths(text: string, images: OwnerImage[], texts: CoreTexts): string {
  if (images.length === 0) return text;
  const lines = images.map((i) => texts.imageAttached(i.path));
  return [text, ...lines].filter((l) => l !== "").join("\n");
}
