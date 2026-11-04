// The core facade (docs/spec/02-architecture.md §1). It receives a Channel; it imports no
// channel package and no Electron.

import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { type AgentConnection, type PermissionRequest, startAgent } from "@agentherd/acp-client";
import type {
  AgentProfile,
  Channel,
  ChannelBinding,
  Inbound,
  Item,
  Mode,
  Rule,
  View,
} from "@agentherd/protocol";
import type { ExtraGuard } from "@agentherd/rules";
import { Board } from "./board.ts";
import { type Clock, systemClock, type Timer } from "./clock.ts";
import { HELP_TEXT, parseCommand } from "./commands.ts";
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
  relayIdleMinutes?: number;
  sessionIdleMinutes?: number;
}

/** Per-task state that only the Herd and its listeners use. */
interface Following {
  task: Task;
  profile: AgentProfile;
  cwd: string;
  alarm: boolean;
  finished: boolean;
  /** The session was in `error` at some point; the task stays failed. */
  failed: boolean;
  ended: boolean;
  /** Text and tool calls of the current turn. */
  turn: { text: string; toolCalls: number };
  connection?: AgentConnection;
  agentSessionId?: string;
  offs: (() => void)[];
  /** Prompts waiting for the current turn to end. */
  queue: QueuedPrompt[];
  busy: boolean;
  /** The reply hint goes only with the first prompt. */
  hinted: boolean;
  idleTimer?: Timer;
}

interface QueuedPrompt {
  text: string;
  resolve: (result: RunResult) => void;
  reject: (error: Error) => void;
}

export interface RunResult {
  sessionId: string;
  stopReason: string;
}

/** The active relay, stored in `herd.db` under {@link RELAY_KEY}. */
export interface RelayState {
  taskId: string;
  startedAt: string;
}

export const RELAY_KEY = "relay";
export const RELAY_IDLE_MINUTES = 30;
export const SESSION_IDLE_MINUTES = 60;

export class Herd {
  readonly store: Store;
  readonly registry: Registry;
  readonly board: Board;
  private readonly inbox: Inbox;
  private readonly watchdog: Watchdog;
  private readonly following = new Map<string, Following>();
  private readonly clock: Clock;
  private started = false;
  private relayTimer: Timer | undefined;

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

  /** All tasks this Herd follows or followed. */
  tasks(): Task[] {
    return [...this.following.values()].map((f) => ({
      ...f.task,
      automaticDecisions: [...f.task.automaticDecisions],
    }));
  }

  /** Tasks whose agent is still running. */
  openTasks(): Task[] {
    return this.tasks().filter((t) => this.following.get(t.id)?.ended === false);
  }

  /** The active relay, if its task is still open. */
  relay(): RelayState | undefined {
    const relay = this.store.getState<RelayState>(RELAY_KEY);
    if (relay === undefined) return undefined;
    const f = this.following.get(relay.taskId);
    return f === undefined || f.ended ? undefined : relay;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // Sessions are not resumed after a restart, so an old relay points at nothing.
    this.store.deleteState(RELAY_KEY);
    await this.opts.channel.start(this.opts.binding, (inbound) => this.handle(inbound));
    this.store.audit("herd.started", { mode: this.opts.mode, channel: this.opts.channel.id });
  }

  /** Inbound from the channel. Errors are recorded, never thrown back into the channel. */
  async handle(inbound: Inbound): Promise<void> {
    try {
      if (inbound.from !== this.opts.binding.ownerId) {
        // The inbox drops and audits everything that does not come from the owner.
        await this.inbox.handle(inbound);
        return;
      }
      if (inbound.kind === "action") {
        if (inbound.action === "relay") return await this.startRelay(inbound.target);
        if (inbound.action === "end-relay") return await this.endRelay("ended by you");
        await this.inbox.handle(inbound);
        return;
      }
      await this.onOwnerMessage(inbound.text);
    } catch (error) {
      this.store.audit("inbound.error", { message: (error as Error).message });
    }
  }

  private async onOwnerMessage(text: string): Promise<void> {
    const command = parseCommand(text);
    const relay = this.relay();
    if (relay !== undefined) this.touchRelay();
    switch (command.kind) {
      case "status":
        await this.board.flush(true);
        return;
      case "help":
        await this.say(HELP_TEXT);
        return;
      case "invalid":
        await this.say(`Usage: ${command.usage}`);
        return;
      case "run":
        await this.runCommand(command.agent, command.dir, command.text);
        return;
      case "relay": {
        const matches = this.findTasks(command.query);
        if (matches.length === 1 && matches[0] !== undefined) {
          await this.startRelay(matches[0].id);
        } else if (matches.length === 0) {
          await this.say(`No open task matches "${command.query}".`);
        } else {
          const list = matches.map((t) => `- ${t.id.slice(0, 8)} ${t.title}`).join("\n");
          await this.say(`More than one task matches "${command.query}":\n${list}`);
        }
        return;
      }
      case "end":
        if (relay === undefined) await this.say("No relay is active.");
        else await this.endRelay("ended by you");
        return;
      case "interrupt":
        if (relay === undefined) {
          await this.say("No relay is active.");
          return;
        }
        this.store.audit("relay.interrupt", { taskId: relay.taskId });
        void this.interruptTask(relay.taskId, command.text).catch(() => {});
        return;
      case "herder":
        await this.say(`No Herder model is configured yet. Commands:\n${HELP_TEXT}`);
        return;
      case "text": {
        if (relay === undefined) {
          await this.say(`No Herder model is configured yet. Commands:\n${HELP_TEXT}`);
          return;
        }
        const f = this.following.get(relay.taskId);
        this.store.audit("relay.message", { taskId: relay.taskId });
        if (f?.busy === true) await this.say("Queued: the agent gets this when its turn ends.");
        void this.promptTask(relay.taskId, command.text).catch(() => {});
        return;
      }
    }
  }

  private async runCommand(agent: string, dir: string, text: string): Promise<void> {
    if (!this.opts.profiles.some((p) => p.id === agent)) {
      const known = this.opts.profiles.map((p) => p.id).join(", ");
      await this.say(`Unknown agent "${agent}". Known: ${known}.`);
      return;
    }
    const cwd = resolve(
      dir === "~" || dir.startsWith("~/") ? join(this.opts.userHome, dir.slice(1)) : dir,
    );
    if (!isDirectory(cwd)) {
      await this.say(`Not a directory: ${cwd}`);
      return;
    }
    try {
      const { turn } = await this.startTask(agent, cwd, text);
      turn.catch(() => {});
    } catch {
      // startTask already sent a report.
    }
  }

  /** Open tasks whose id starts with the query, or whose title has every word of it. */
  private findTasks(query: string): Task[] {
    const q = query.trim().toLowerCase();
    const open = this.openTasks();
    const byId = open.filter((t) => t.id.startsWith(q));
    if (byId.length > 0) return byId;
    const words = q.split(/\s+/).filter((w) => w !== "");
    return open.filter((t) => words.every((w) => t.title.toLowerCase().includes(w)));
  }

  private async startRelay(taskId: string): Promise<void> {
    const f = this.following.get(taskId);
    if (f === undefined || f.ended) {
      await this.say("That task has ended; there is nothing to relay to.");
      return;
    }
    const current = this.relay();
    if (current?.taskId === taskId) return;
    if (current !== undefined) await this.endRelay("another relay started");
    const state: RelayState = { taskId, startedAt: this.clock.now().toISOString() };
    this.store.setState(RELAY_KEY, state);
    this.store.audit("relay.started", { taskId });
    this.touchRelay();
    await this.send({ kind: "relay", taskId, taskLabel: f.task.title, active: true });
  }

  private async endRelay(why: string): Promise<void> {
    const relay = this.store.getState<RelayState>(RELAY_KEY);
    if (relay === undefined) return;
    this.store.deleteState(RELAY_KEY);
    this.relayTimer?.cancel();
    this.relayTimer = undefined;
    this.store.audit("relay.ended", { taskId: relay.taskId, why });
    const label = this.following.get(relay.taskId)?.task.title ?? relay.taskId;
    await this.send({ kind: "relay", taskId: relay.taskId, taskLabel: label, active: false });
  }

  /** Restarts the relay idle timer on every owner message. */
  private touchRelay(): void {
    this.relayTimer?.cancel();
    const minutes = this.opts.relayIdleMinutes ?? RELAY_IDLE_MINUTES;
    this.relayTimer = this.clock.after(minutes * 60_000, () => {
      this.relayTimer = undefined;
      void this.endRelay(`no message for ${minutes} minutes`);
    });
  }

  private async say(text: string, taskLabel?: string): Promise<void> {
    await this.send(
      taskLabel === undefined ? { kind: "text", text } : { kind: "text", text, taskLabel },
    );
  }

  private async send(view: View): Promise<void> {
    try {
      await this.opts.channel.send(view);
    } catch (error) {
      this.store.audit("send.error", { kind: view.kind, message: (error as Error).message });
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
    const { taskId, turn } = await this.startTask(profileId, cwd, prompt);
    try {
      return await turn;
    } finally {
      await this.endTask(taskId, "the run finished");
    }
  }

  /**
   * Starts an agent and a session for a task and sends the owner's text as the first prompt.
   * Returns once the session exists; `turn` settles when the first turn ends.
   */
  async startTask(
    profileId: string,
    cwd: string,
    ownerText: string,
  ): Promise<{ taskId: string; turn: Promise<RunResult> }> {
    const profile = this.opts.profiles.find((p) => p.id === profileId);
    if (profile === undefined) throw new Error(`unknown agent profile "${profileId}"`);
    const sessionId = randomUUID();
    const now = this.clock.now().toISOString();
    const f: Following = {
      task: {
        id: sessionId,
        title: taskTitle(ownerText),
        project: projectName(cwd),
        agent: profile.name,
        stage: "queued",
        lastReport: "Starting",
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
    this.following.set(sessionId, f);
    this.registry.add(sessionId, profile.id, cwd);
    this.board.changed();

    try {
      const connection = await startAgent(profile, { cwd });
      f.connection = connection;
      f.agentSessionId = await connection.newSession(cwd);
    } catch (error) {
      const message = (error as Error).message;
      this.setReport(f, `Could not start: ${message}`);
      this.registry.set(sessionId, "error");
      await this.sendReport(f, `Could not start the agent: ${message}`, null);
      await this.endTask(sessionId, "the agent could not start");
      throw error;
    }
    this.store.audit("session.started", {
      sessionId,
      profileId,
      cwd,
      agentSessionId: f.agentSessionId,
    });
    this.watchdog.track(sessionId);
    this.listen(f, f.connection, f.agentSessionId);
    return { taskId: sessionId, turn: this.promptTask(sessionId, ownerText) };
  }

  /** Sends a prompt to an open task. Queued while a turn runs; settles when its turn ends. */
  promptTask(taskId: string, text: string): Promise<RunResult> {
    const f = this.following.get(taskId);
    if (f === undefined || f.ended) return Promise.reject(new Error(`task ${taskId} is not open`));
    const done = new Promise<RunResult>((resolve, reject) => {
      f.queue.push({ text, resolve, reject });
    });
    void this.pump(f);
    return done;
  }

  /** Cancels the current turn of a task, then sends the text as the next prompt. */
  async interruptTask(taskId: string, text: string): Promise<RunResult> {
    const f = this.following.get(taskId);
    if (f === undefined || f.ended) throw new Error(`task ${taskId} is not open`);
    const next = this.promptTask(taskId, text);
    if (f.busy && f.connection !== undefined && f.agentSessionId !== undefined) {
      await f.connection.cancel(f.agentSessionId);
    }
    return next;
  }

  /** Closes the agent of a task. The task stays on the board. */
  async endTask(taskId: string, why: string): Promise<void> {
    const f = this.following.get(taskId);
    if (f === undefined || f.ended) return;
    f.ended = true;
    f.idleTimer?.cancel();
    this.watchdog.untrack(taskId);
    for (const off of f.offs) off();
    f.offs = [];
    for (const queued of f.queue.splice(0)) queued.reject(new Error(`the task ended: ${why}`));
    await this.inbox.expireSession(taskId, why);
    await f.connection?.close();
    this.registry.set(taskId, "ended");
    this.store.audit("task.ended", { taskId, why });
    if (this.store.getState<RelayState>(RELAY_KEY)?.taskId === taskId) {
      await this.endRelay("the task ended");
    }
    await this.board.flush();
  }

  private listen(f: Following, connection: AgentConnection, agentSessionId: string): void {
    const sessionId = f.task.id;
    f.offs = [
      connection.on("permission", (request) => {
        if (request.sessionId !== agentSessionId) return;
        this.watchdog.event(sessionId);
        void this.onPermission(sessionId, f.profile, f.cwd, request).catch((error: Error) => {
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
        if (state !== "waiting-approval" && f.busy) this.registry.set(sessionId, "working");
      }),
      connection.on("exit", (e) => {
        this.store.audit("session.exited", { sessionId, code: e.code, signal: e.signal });
        if (f.busy) {
          this.watchdog.exited(sessionId, `the agent exited (code ${e.code ?? e.signal})`);
        }
        if (!f.ended) this.registry.set(sessionId, e.code === 0 ? "ended" : "error");
        if (!f.busy && !f.ended) void this.endTask(sessionId, "the agent exited");
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
    const minutes = this.opts.sessionIdleMinutes ?? SESSION_IDLE_MINUTES;
    f.idleTimer = this.clock.after(minutes * 60_000, () => {
      void this.endTask(f.task.id, `no prompt for ${minutes} minutes`);
    });
  }

  private async runTurn(f: Following, text: string): Promise<RunResult> {
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
      prompt = `${replyHint(this.opts.replyHintChars ?? REPLY_HINT_CHARS)}\n\n${text}`;
    }
    this.registry.set(sessionId, "working");
    this.watchdog.turnStarted(sessionId);
    try {
      const { stopReason } = await connection.prompt(agentSessionId, prompt);
      this.watchdog.turnEnded(sessionId);
      f.finished = stopReason === "end_turn";
      this.store.audit("turn.ended", { sessionId, stopReason });
      this.registry.set(sessionId, "idle");
      await this.inbox.expireSession(sessionId, "the agent's turn ended");
      const reply = f.turn.text;
      if (this.relay()?.taskId === sessionId) {
        this.setReport(f, `Relayed: ${firstLine(reply)}`);
        await this.say(reply.trim() === "" ? "(no reply)" : reply, f.task.title);
        this.store.audit("relay.reply", { taskId: sessionId, stopReason });
      } else {
        await this.sendReport(f, reply, () => this.askSummary(connection, agentSessionId, f));
      }
      return { sessionId, stopReason };
    } catch (error) {
      const message = (error as Error).message;
      this.watchdog.turnEnded(sessionId);
      if (this.registry.get(sessionId)?.state !== "ended") this.registry.set(sessionId, "error");
      await this.sendReport(f, `The task failed: ${message}`, null);
      await this.endTask(sessionId, "the turn failed");
      throw error;
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
    this.relayTimer?.cancel();
    for (const f of this.following.values()) {
      if (!f.ended) await this.endTask(f.task.id, "AgentHerd stopped");
    }
    await this.inbox.stop();
    if (this.started) await this.opts.channel.stop();
    this.store.audit("herd.stopped", {});
    if (this.opts.store === undefined) this.store.close();
  }
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.length <= 80 ? line : `${line.slice(0, 79)}…`;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
