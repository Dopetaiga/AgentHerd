// The core facade (docs/spec/02-architecture.md §1). It receives a Channel; it imports no
// channel package and no Electron.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { type AgentConnection, type PermissionRequest, startAgent } from "@agentherd/acp-client";
import type {
  AgentProfile,
  Channel,
  ChannelBinding,
  Inbound,
  Item,
  Mode,
  Rule,
} from "@agentherd/protocol";
import type { ExtraGuard } from "@agentherd/rules";
import { Board } from "./board.ts";
import { type Clock, systemClock } from "./clock.ts";
import { Inbox } from "./inbox.ts";
import { decide } from "./pipeline.ts";
import { Registry } from "./registry.ts";
import {
  REPLY_HINT_CHARS,
  REPORT_MAX_CHARS,
  replyHint,
  reportBody,
  reportView,
  type SummaryAnswer,
  summaryPrompt,
} from "./report.ts";
import { Store } from "./store.ts";
import { projectName, stageOf, type Task, taskTitle } from "./tasks.ts";
import { type Alarm, Watchdog } from "./watchdog.ts";

export interface HerdOptions {
  /** AgentHerd home (`AGENTHERD_HOME` or `~/.agentherd`). `herd.db` lives here. */
  home: string;
  /** The user's home directory, for `~` in commands and rules. */
  userHome: string;
  channel: Channel;
  binding: ChannelBinding;
  mode: Mode;
  profiles: AgentProfile[];
  clock?: Clock;
  remindMinutes?: number;
  extraGuards?: ExtraGuard[];
  /** Values to redact everywhere (secrets from env). */
  secrets?: Record<string, string>;
  /** Use this store instead of `<home>/herd.db` (tests pass `:memory:`). */
  store?: Store;
  reportMaxChars?: number;
  replyHintChars?: number;
  watchdogSeconds?: number;
  maxQuietMinutes?: number;
  boardDebounceMs?: number;
}

/** Per-task state that only `run()` and its listeners use. */
interface Following {
  task: Task;
  alarm: boolean;
  finished: boolean;
  /** The session was in `error` at some point; the task stays failed. */
  failed: boolean;
  /** Text and tool calls of the current turn. */
  turn: { text: string; toolCalls: number };
}

export interface RunResult {
  sessionId: string;
  stopReason: string;
}

export class Herd {
  readonly store: Store;
  readonly registry: Registry;
  readonly board: Board;
  private readonly inbox: Inbox;
  private readonly watchdog: Watchdog;
  private readonly following = new Map<string, Following>();
  private readonly clock: Clock;
  private readonly connections = new Set<AgentConnection>();
  private started = false;

  private readonly opts: HerdOptions;

  constructor(opts: HerdOptions) {
    this.opts = opts;
    this.clock = opts.clock ?? systemClock;
    const storeOptions = opts.secrets === undefined ? {} : { secrets: opts.secrets };
    this.store = opts.store ?? Store.open(join(opts.home, "herd.db"), storeOptions);
    this.registry = new Registry(this.store, this.clock);
    const inboxOptions = {
      channel: opts.channel,
      binding: opts.binding,
      store: this.store,
      clock: this.clock,
      ...(opts.remindMinutes === undefined ? {} : { remindMinutes: opts.remindMinutes }),
      ...(opts.secrets === undefined ? {} : { secrets: opts.secrets }),
    };
    this.inbox = new Inbox(inboxOptions);
    this.board = new Board({
      channel: opts.channel,
      store: this.store,
      clock: this.clock,
      tasks: () => this.tasks(),
      ...(opts.boardDebounceMs === undefined ? {} : { debounceMs: opts.boardDebounceMs }),
    });
    this.watchdog = new Watchdog({
      clock: this.clock,
      onAlarm: (alarm) => void this.onAlarm(alarm),
      ...(opts.watchdogSeconds === undefined ? {} : { watchdogSeconds: opts.watchdogSeconds }),
      ...(opts.maxQuietMinutes === undefined ? {} : { maxQuietMinutes: opts.maxQuietMinutes }),
    });
    this.registry.onChange((row) => {
      this.watchdog.waiting(row.id, row.state === "waiting-approval");
      const f = this.following.get(row.id);
      if (f !== undefined) this.restage(f);
    });
  }

  /** All tasks this Herd follows or followed, newest first. */
  tasks(): Task[] {
    return [...this.following.values()].map((f) => ({
      ...f.task,
      automaticDecisions: [...f.task.automaticDecisions],
    }));
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.opts.channel.start(this.opts.binding, (inbound) => this.handle(inbound));
    this.store.audit("herd.started", { mode: this.opts.mode, channel: this.opts.channel.id });
  }

  /** Inbound from the channel. Errors are recorded, never thrown back into the channel. */
  async handle(inbound: Inbound): Promise<void> {
    try {
      if (
        inbound.kind === "message" &&
        inbound.from === this.opts.binding.ownerId &&
        inbound.text.trim().toLowerCase() === "status"
      ) {
        await this.board.flush(true);
        return;
      }
      await this.inbox.handle(inbound);
    } catch (error) {
      this.store.audit("inbound.error", { message: (error as Error).message });
    }
  }

  addRule(rule: Rule): void {
    this.store.insertRule(rule);
  }

  /**
   * Starts an agent for a task, runs the owner's prompt to the end of the turn, sends the
   * completion report, then closes the agent. The task stays on the board.
   */
  async run(profileId: string, cwd: string, prompt: string): Promise<RunResult> {
    const profile = this.opts.profiles.find((p) => p.id === profileId);
    if (profile === undefined) throw new Error(`unknown agent profile "${profileId}"`);
    const sessionId = randomUUID();
    const now = this.clock.now().toISOString();
    const f: Following = {
      task: {
        id: sessionId,
        title: taskTitle(prompt),
        project: projectName(cwd),
        agent: profile.name,
        stage: "queued",
        lastReport: "Starting",
        startedAt: now,
        updatedAt: now,
        automaticDecisions: [],
      },
      alarm: false,
      finished: false,
      failed: false,
      turn: { text: "", toolCalls: 0 },
    };
    this.following.set(sessionId, f);
    this.registry.add(sessionId, profile.id, cwd);
    this.board.changed();

    let connection: AgentConnection;
    let agentSessionId: string;
    try {
      connection = await startAgent(profile, { cwd });
      this.connections.add(connection);
      agentSessionId = await connection.newSession(cwd);
    } catch (error) {
      this.setReport(f, `Could not start: ${(error as Error).message}`);
      this.registry.set(sessionId, "error");
      this.registry.set(sessionId, "ended");
      await this.sendReport(f, `Could not start the agent: ${(error as Error).message}`, null);
      throw error;
    }
    this.store.audit("session.started", { sessionId, profileId, cwd, agentSessionId });
    this.watchdog.track(sessionId);

    const offs = [
      connection.on("permission", (request) => {
        if (request.sessionId !== agentSessionId) return;
        this.watchdog.event(sessionId);
        void this.onPermission(sessionId, profile, cwd, request).catch((error: Error) => {
          // Never leave the agent without an answer it can act on: cancel, never allow.
          request.respond({ kind: "cancelled" });
          this.store.audit("permission.error", { sessionId, message: error.message });
        });
      }),
      connection.on("update", (u) => {
        if (u.sessionId !== agentSessionId) return;
        if (u.type === "message") f.turn.text += u.text ?? "";
        if (u.type === "tool_call" && u.toolCall !== undefined) {
          f.turn.toolCalls += 1;
          const key = `${u.toolCall.title}\u0000${JSON.stringify(u.toolCall.rawInput ?? u.toolCall.command ?? "")}`;
          this.watchdog.toolCall(sessionId, key, u.toolCall.command ?? u.toolCall.title);
        } else {
          this.watchdog.event(sessionId);
        }
        const state = this.registry.get(sessionId)?.state;
        if (state !== "waiting-approval") this.registry.set(sessionId, "working");
      }),
      connection.on("exit", (e) => {
        this.store.audit("session.exited", { sessionId, code: e.code, signal: e.signal });
        if (!f.finished) {
          this.watchdog.exited(sessionId, `the agent exited (code ${e.code ?? e.signal})`);
        }
        this.registry.set(sessionId, e.code === 0 ? "ended" : "error");
      }),
    ];

    let stopReason = "error";
    let failure: string | null = null;
    try {
      this.registry.set(sessionId, "working");
      this.watchdog.turnStarted(sessionId);
      const hint = replyHint(this.opts.replyHintChars ?? REPLY_HINT_CHARS);
      ({ stopReason } = await connection.prompt(agentSessionId, `${hint}\n\n${prompt}`));
      this.watchdog.turnEnded(sessionId);
      f.finished = stopReason === "end_turn";
      this.store.audit("turn.ended", { sessionId, stopReason });
      this.registry.set(sessionId, "idle");
      await this.inbox.expireSession(sessionId, "the agent's turn ended");
      const reply = f.turn.text;
      await this.sendReport(f, reply, () => this.askSummary(connection, agentSessionId, f));
      return { sessionId, stopReason };
    } catch (error) {
      failure = (error as Error).message;
      throw error;
    } finally {
      this.watchdog.untrack(sessionId);
      await this.inbox.expireSession(sessionId, "the agent's turn ended");
      for (const off of offs) off();
      await connection.close();
      this.connections.delete(connection);
      if (failure !== null && this.registry.get(sessionId)?.state !== "ended") {
        this.registry.set(sessionId, "error");
        await this.sendReport(f, `The task failed: ${failure}`, null);
      }
      this.registry.set(sessionId, "ended");
      await this.board.flush();
    }
  }

  /** Asks the session for its own short summary (docs/spec/04-herder.md "Completion report"). */
  private async askSummary(
    connection: AgentConnection,
    agentSessionId: string,
    f: Following,
  ): Promise<SummaryAnswer> {
    f.turn = { text: "", toolCalls: 0 };
    const max = this.opts.reportMaxChars ?? REPORT_MAX_CHARS;
    await connection.prompt(agentSessionId, summaryPrompt(max));
    return { text: f.turn.text, toolCalls: f.turn.toolCalls };
  }

  /** Sends the completion report once per task. */
  private async sendReport(
    f: Following,
    reply: string,
    ask: (() => Promise<SummaryAnswer>) | null,
  ): Promise<void> {
    if (f.task.lastReport.startsWith("Reported")) return;
    const max = this.opts.reportMaxChars ?? REPORT_MAX_CHARS;
    const body = await reportBody(
      reply,
      ask ?? (() => Promise.reject(new Error("no summary turn"))),
      max,
    );
    this.restage(f);
    const view = reportView(f.task, body, this.clock.now());
    try {
      await this.opts.channel.send(view);
      this.store.audit("report.sent", { taskId: f.task.id, summarized: body.summarized });
    } catch (error) {
      this.store.audit("report.error", { taskId: f.task.id, message: (error as Error).message });
    }
    this.setReport(f, `Reported: ${firstLine(body.body)}`);
  }

  private async onAlarm(alarm: Alarm): Promise<void> {
    const f = this.following.get(alarm.sessionId);
    if (f === undefined) return;
    f.alarm = true;
    this.store.audit("watchdog.alarm", { ...alarm });
    this.setReport(f, `Watchdog: ${alarm.detail}`);
    try {
      await this.opts.channel.send({
        kind: "text",
        taskLabel: f.task.title,
        text: `Watchdog: ${alarm.detail}`,
      });
    } catch (error) {
      this.store.audit("watchdog.error", { message: (error as Error).message });
    }
  }

  private setReport(f: Following, text: string): void {
    f.task.lastReport = text;
    f.task.updatedAt = this.clock.now().toISOString();
    this.board.changed();
  }

  /** Recomputes the stage of a task from its session; updates the board if it changed. */
  private restage(f: Following): void {
    const row = this.registry.get(f.task.id);
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
    f.task.updatedAt = this.clock.now().toISOString();
    this.board.changed();
  }

  private async onPermission(
    sessionId: string,
    profile: AgentProfile,
    cwd: string,
    request: PermissionRequest,
  ): Promise<void> {
    const item: Item = {
      id: randomUUID(),
      sessionId,
      profileId: profile.id,
      cwd,
      kind: "permission",
      state: "open",
      createdAt: this.clock.now().toISOString(),
      toolCall: request.toolCall,
      title: request.toolCall.title,
      body: request.toolCall.command ?? request.toolCall.paths.join("\n"),
      risk: "medium",
    };
    const result = decide(item, {
      mode: this.opts.mode,
      rules: this.store.listRules(),
      home: this.opts.userHome,
      ...(this.opts.extraGuards === undefined ? {} : { extraGuards: this.opts.extraGuards }),
    });
    item.risk = result.decision.risk;
    this.store.insertItem(item);
    if (result.suggestion !== undefined) {
      const { action, reason, confidence } = result.suggestion;
      this.store.audit("item.suggestion", { itemId: item.id, action, reason, confidence });
    }

    const now = () => this.clock.now().toISOString();
    if (result.apply) {
      const action = result.decision.action;
      const answered =
        (action === "allow" || action === "deny") && request.respond({ kind: action });
      if (answered) {
        this.store.insertDecision(result.decision, {
          ...(result.ruleId === undefined ? {} : { ruleId: result.ruleId }),
          createdAt: now(),
        });
        this.store.updateItem(item.id, { state: "decided", decidedAt: now() });
        this.store.audit("item.decided", { itemId: item.id, source: "rule", action });
        const f = this.following.get(sessionId);
        if (f !== undefined) {
          const verb = action === "allow" ? "Allowed" : "Denied";
          const rule = result.ruleId === undefined ? "" : ` ${result.ruleId}`;
          f.task.automaticDecisions.push(`${verb} by rule${rule}: ${item.body || item.title}`);
        }
      } else {
        this.store.updateItem(item.id, { state: "expired", decidedAt: now() });
      }
      return;
    }

    this.registry.set(sessionId, "waiting-approval");
    await this.inbox.add(
      item,
      {
        answer: (answer) => {
          const ok = request.respond({ kind: answer });
          if (ok) this.registry.set(sessionId, "working");
          return ok;
        },
      },
      result.decision.reason,
      this.following.get(sessionId)?.task.title,
    );
  }

  async stop(): Promise<void> {
    this.board.stop();
    this.watchdog.stop();
    await this.inbox.stop();
    await Promise.all([...this.connections].map((c) => c.close()));
    this.connections.clear();
    if (this.started) await this.opts.channel.stop();
    this.store.audit("herd.stopped", {});
    if (this.opts.store === undefined) this.store.close();
  }
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.length <= 80 ? line : `${line.slice(0, 79)}…`;
}
