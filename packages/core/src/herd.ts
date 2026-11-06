// The core facade (docs/spec/02-architecture.md §1). It receives a Channel; it imports no
// channel package and no Electron. The work lives in the parts it wires together:
// owner-commands.ts (inbound), relay.ts, task-runner.ts (task lifecycle and turns),
// task-report.ts (reports, alarms, stages) and permission.ts.

import { join } from "node:path";
import type { AgentProfile, Inbound, Mode, Rule } from "@agentherd/protocol";
import { DEFAULT_LOCALE } from "@agentherd/protocol";
import { Board } from "./board.ts";
import { type Clock, systemClock } from "./clock.ts";
import {
  allTasks,
  type Following,
  type HerdContext,
  type HerdOptions,
  openTasks,
  type RunResult,
  say,
  send,
} from "./herd-context.ts";
import {
  HERDER_RETRY_TARGET,
  type HerderFactory,
  type HerderHost,
  type HerderPort,
  type OwnerImage,
} from "./herder-port.ts";
import { Inbox } from "./inbox.ts";
import { OwnerCommands } from "./owner-commands.ts";
import { Registry } from "./registry.ts";
import { Relay, type RelayState } from "./relay.ts";
import { Store, type TranscriptEntry } from "./store.ts";
import { onAlarm, restage } from "./task-report.ts";
import { TaskRunner } from "./task-runner.ts";
import type { Task } from "./tasks.ts";
import { type CoreTexts, coreTexts } from "./texts.ts";
import { Watchdog } from "./watchdog.ts";

export type { AgentModels, HerdOptions, RunResult } from "./herd-context.ts";
export { RELAY_IDLE_MINUTES, RELAY_KEY, type RelayState } from "./relay.ts";
export { SESSION_IDLE_MINUTES } from "./task-runner.ts";

export class Herd {
  readonly store: Store;
  readonly registry: Registry;
  readonly board: Board;
  private readonly ctx: HerdContext;
  private readonly relays: Relay;
  private readonly runner: TaskRunner;
  private readonly owner: OwnerCommands;
  private readonly clock: Clock;
  private readonly texts: CoreTexts;
  private started = false;
  private herder: HerderPort | undefined;
  private mode: Mode;

  private readonly opts: HerdOptions;

  constructor(opts: HerdOptions) {
    this.opts = opts;
    this.mode = opts.mode;
    this.texts = coreTexts(opts.locale ?? DEFAULT_LOCALE);
    this.clock = opts.clock ?? systemClock;
    const storeOptions = opts.secrets === undefined ? {} : { secrets: opts.secrets };
    this.store = opts.store ?? Store.open(join(opts.home, "herd.db"), storeOptions);
    this.registry = new Registry(this.store, this.clock);
    const inbox = new Inbox({
      channel: opts.channel,
      binding: opts.binding,
      store: this.store,
      clock: this.clock,
      ...(opts.remindMinutes === undefined ? {} : { remindMinutes: opts.remindMinutes }),
      ...(opts.secrets === undefined ? {} : { secrets: opts.secrets }),
      texts: this.texts,
    });
    this.board = new Board({
      channel: opts.channel,
      store: this.store,
      clock: this.clock,
      tasks: () => this.tasks(),
      ...(opts.boardDebounceMs === undefined ? {} : { debounceMs: opts.boardDebounceMs }),
    });
    const watchdog = new Watchdog({
      clock: this.clock,
      onAlarm: (alarm) => void onAlarm(this.ctx, alarm),
      texts: this.texts,
      ...(opts.watchdogSeconds === undefined ? {} : { watchdogSeconds: opts.watchdogSeconds }),
      ...(opts.maxQuietMinutes === undefined ? {} : { maxQuietMinutes: opts.maxQuietMinutes }),
    });
    this.ctx = {
      opts,
      store: this.store,
      registry: this.registry,
      board: this.board,
      inbox,
      watchdog,
      clock: this.clock,
      texts: this.texts,
      following: new Map<string, Following>(),
      herder: () => this.herder,
      mode: () => this.mode,
    };
    this.relays = new Relay(this.ctx);
    this.runner = new TaskRunner(this.ctx, this.relays, this);
    this.owner = new OwnerCommands(this.ctx, this.relays, this);
    this.registry.onChange((row) => {
      watchdog.waiting(row.id, row.state === "waiting-approval");
      const f = this.ctx.following.get(row.id);
      if (f !== undefined) restage(this.ctx, f);
    });
    this.herder = opts.herder?.(this.herderHost());
  }

  /** Replaces the Herder, e.g. after the owner chose another model. `undefined` turns it off. */
  async setHerder(factory: HerderFactory | undefined): Promise<void> {
    const old = this.herder;
    this.herder = undefined;
    await old?.stop();
    this.herder = factory?.(this.herderHost());
    this.store.audit("herder.changed", { on: this.herder !== undefined });
  }

  hasHerder(): boolean {
    return this.herder !== undefined;
  }

  /** Agent profiles for tasks started after the change; running tasks keep theirs. */
  setProfiles(profiles: AgentProfile[]): void {
    this.opts.profiles = profiles;
  }

  getMode(): Mode {
    return this.mode;
  }

  /** Applies to permission requests that arrive after the change. */
  setMode(mode: Mode): void {
    this.mode = mode;
    this.store.audit("mode.changed", { mode });
  }

  private herderHost(): HerderHost {
    return {
      locale: this.opts.locale ?? DEFAULT_LOCALE,
      texts: this.texts,
      userHome: this.opts.userHome,
      profiles: () => this.opts.profiles.map((p) => ({ id: p.id, name: p.name })),
      tasks: () => this.tasks(),
      openTasks: () => this.openTasks(),
      relayTaskId: () => this.relay()?.taskId,
      decisions: (limit) => this.store.recentDecisions(limit),
      models: () => this.opts.agentModels?.list() ?? [],
      checkModel: async (ref) => this.opts.agentModels?.check?.(ref) ?? { ok: true },
      startTask: async (profileId, cwd, title, prompt, model, images) => {
        const { taskId, turn } = await this.startTask(profileId, cwd, title, prompt, model, images);
        turn.catch(() => {});
        return taskId;
      },
      promptTask: (taskId, text, images) =>
        void this.promptTask(taskId, text, images).catch(() => {}),
      renameTask: (taskId, name) => this.runner.renameTask(taskId, name),
      cancelTurn: (taskId) => this.cancelTurn(taskId),
      startRelay: (taskId) => this.relays.start(taskId),
      endRelay: () => this.relays.end("ended by the Herder"),
      say: (text) => say(this.ctx, text),
      ask: (text, options) => this.owner.ask(text, options),
      alert: (text, retry) =>
        send(this.ctx, {
          kind: "text",
          text,
          tone: "error",
          ...(retry
            ? {
                target: HERDER_RETRY_TARGET,
                options: [{ action: "retry", label: this.texts.retry }],
              }
            : {}),
        }),
      audit: (type, data) => this.store.audit(type, data),
      recordTurn: (role, text, taskId) => this.store.addHerderTurn(role, text, taskId),
      getState: (key) => this.store.getState(key),
      setState: (key, value) => this.store.setState(key, value),
    };
  }

  /** All tasks this Herd follows or followed. */
  tasks(): Task[] {
    return allTasks(this.ctx);
  }

  /** A task's conversation; `live` is reply text still being written. */
  transcript(taskId: string): { entries: TranscriptEntry[]; live: string } {
    const f = this.ctx.following.get(taskId);
    return { entries: this.store.transcript(taskId), live: f?.ended ? "" : (f?.pending ?? "") };
  }

  /** Tasks whose agent is still running. */
  openTasks(): Task[] {
    return openTasks(this.ctx);
  }

  /** The active relay, if its task is still open. */
  relay(): RelayState | undefined {
    return this.relays.current();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // Sessions are not resumed after a restart, so an old relay points at nothing.
    this.relays.reset();
    await this.opts.channel.start(this.opts.binding, (inbound) => this.handle(inbound));
    this.store.audit("herd.started", { mode: this.mode, channel: this.opts.channel.id });
  }

  /** Inbound from the channel. Errors are recorded, never thrown back into the channel. */
  handle(inbound: Inbound): Promise<void> {
    return this.owner.handle(inbound);
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
      await this.endTask(taskId, this.texts.runFinished);
    }
  }

  /**
   * Starts an agent and a session for a task and sends the owner's text as the first prompt.
   * Returns once the session exists; `turn` settles when the first turn ends.
   */
  startTask(
    profileId: string,
    cwd: string,
    ownerText: string,
    prompt: string = ownerText,
    model?: string,
    images?: OwnerImage[],
  ): Promise<{ taskId: string; turn: Promise<RunResult> }> {
    return this.runner.startTask(profileId, cwd, ownerText, prompt, model, images);
  }

  /** Sends a prompt to an open task. Queued while a turn runs; settles when its turn ends. */
  promptTask(taskId: string, text: string, images?: OwnerImage[]): Promise<RunResult> {
    return this.runner.promptTask(taskId, text, images);
  }

  /** Cancels the current turn of a task, then sends the text as the next prompt. */
  interruptTask(taskId: string, text: string, images?: OwnerImage[]): Promise<RunResult> {
    return this.runner.interruptTask(taskId, text, images);
  }

  /** Cancels the current turn of a task, if one is running. */
  cancelTurn(taskId: string): Promise<void> {
    return this.runner.cancelTurn(taskId);
  }

  /** Closes the agent of a task. The task stays on the board. */
  endTask(taskId: string, why: string): Promise<void> {
    return this.runner.endTask(taskId, why);
  }

  async stop(): Promise<void> {
    await this.herder?.stop();
    this.board.stop();
    this.ctx.watchdog.stop();
    this.relays.stop();
    for (const f of this.ctx.following.values()) {
      if (!f.ended) await this.endTask(f.task.id, this.texts.agentherdStopped);
    }
    await this.ctx.inbox.stop();
    if (this.started) await this.opts.channel.stop();
    this.store.audit("herd.stopped", {});
    if (this.opts.store === undefined) this.store.close();
  }
}
