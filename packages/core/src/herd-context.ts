// Shared state and small helpers for the parts of the Herd (see herd.ts).

import type { AgentConnection } from "@agentherd/acp-client";
import type {
  AgentProfile,
  Channel,
  ChannelBinding,
  Locale,
  Mode,
  View,
} from "@agentherd/protocol";
import type { ExtraGuard } from "@agentherd/rules";
import type { Board } from "./board.ts";
import type { Clock, Timer } from "./clock.ts";
import type { HerderFactory, HerderPort } from "./herder-port.ts";
import type { Inbox } from "./inbox.ts";
import type { Registry } from "./registry.ts";
import type { Store } from "./store.ts";
import type { Task } from "./tasks.ts";
import type { CoreTexts } from "./texts.ts";
import type { Watchdog } from "./watchdog.ts";

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
  /** Language of the texts the owner reads. Default: Chinese. */
  locale?: Locale;
  /** Creates the Herder. Without it, plain messages get the list of commands. */
  herder?: HerderFactory;
  /** Models a task can run with. Without it, agents use their own settings. */
  agentModels?: AgentModels;
}

/** The owner's models and how an agent runs one (ADR 0025). Supplied by the host. */
export interface AgentModels {
  /** Models in the owner's list ("service/model"), with the profile ids that can run each. */
  list(): { ref: string; agents: string[] }[];
  /** The env that makes the agent use the model. Throws when it cannot. */
  envFor(profileId: string, ref: string): Record<string, string>;
  /** Whether the model answers now (a short test call, may be cached). */
  check?(ref: string): Promise<{ ok: true } | { ok: false; message: string }>;
}

/** Per-task state that only the Herd and its listeners use. */
export interface Following {
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

export interface QueuedPrompt {
  text: string;
  resolve: (result: RunResult) => void;
  reject: (error: Error) => void;
}

export interface RunResult {
  sessionId: string;
  stopReason: string;
}

/** What the parts of the Herd share. The Herd owns it; the parts only read the fields. */
export interface HerdContext {
  readonly opts: HerdOptions;
  readonly store: Store;
  readonly registry: Registry;
  readonly board: Board;
  readonly inbox: Inbox;
  readonly watchdog: Watchdog;
  readonly clock: Clock;
  readonly texts: CoreTexts;
  readonly following: Map<string, Following>;
  /** The current Herder, if any. It can change at runtime. */
  herder(): HerderPort | undefined;
  /** The current mode. It can change at runtime. */
  mode(): Mode;
}

/**
 * The task methods of the Herd. The parts call them through the Herd, not directly, so the
 * Herd stays the one entry point (tests and callers may wrap its methods).
 */
export interface TaskOps {
  startTask(
    profileId: string,
    cwd: string,
    ownerText: string,
    prompt?: string,
    model?: string,
  ): Promise<{ taskId: string; turn: Promise<RunResult> }>;
  promptTask(taskId: string, text: string): Promise<RunResult>;
  interruptTask(taskId: string, text: string): Promise<RunResult>;
  endTask(taskId: string, why: string): Promise<void>;
}

/** All tasks the Herd follows or followed, as copies. */
export function allTasks(ctx: HerdContext): Task[] {
  return [...ctx.following.values()].map((f) => ({
    ...f.task,
    automaticDecisions: [...f.task.automaticDecisions],
  }));
}

/** Tasks whose agent is still running. */
export function openTasks(ctx: HerdContext): Task[] {
  return allTasks(ctx).filter((t) => ctx.following.get(t.id)?.ended === false);
}

export async function say(ctx: HerdContext, text: string, taskLabel?: string): Promise<void> {
  await send(
    ctx,
    taskLabel === undefined ? { kind: "text", text } : { kind: "text", text, taskLabel },
  );
}

/** Sends a view; a failure is audited, never thrown. */
export async function send(ctx: HerdContext, view: View): Promise<void> {
  try {
    await ctx.opts.channel.send(view);
  } catch (error) {
    ctx.store.audit("send.error", { kind: view.kind, message: (error as Error).message });
  }
}

export function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.length <= 80 ? line : `${line.slice(0, 79)}…`;
}
