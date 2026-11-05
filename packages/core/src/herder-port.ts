// What the Herd and the Herder know about each other (docs/spec/04-herder.md §1). The core does
// not import the Herder or any model library: the CLI or the app passes a factory.

import type { Locale } from "@agentherd/protocol";
import type { DecisionRow } from "./store.ts";
import type { Task } from "./tasks.ts";
import type { CoreTexts } from "./texts.ts";

export interface HerderEvent {
  kind: "task-reported" | "watchdog";
  taskId: string;
  title: string;
  /** Text that came from an agent. Untrusted. */
  text: string;
}

/** Everything the Herder can do. There is deliberately nothing here that answers an item. */
export interface HerderHost {
  readonly locale: Locale;
  readonly texts: CoreTexts;
  readonly userHome: string;
  profiles(): { id: string; name: string }[];
  tasks(): Task[];
  openTasks(): Task[];
  recentProjects(): string[];
  relayTaskId(): string | undefined;
  decisions(limit: number): DecisionRow[];
  /** Models in the owner's list ("service/model") and the profile ids that can run each. */
  models(): { ref: string; agents: string[] }[];
  /** Whether a model answers now; true when there is nothing to check with. */
  checkModel(ref: string): Promise<{ ok: true } | { ok: false; message: string }>;
  /**
   * `title` is the task's short name, chosen by the Herder; `prompt` is what the agent receives. `model` ("service/model")
   * runs the agent with that model; without it the agent uses its own settings.
   */
  startTask(
    profileId: string,
    cwd: string,
    title: string,
    prompt: string,
    model?: string,
  ): Promise<string>;
  promptTask(taskId: string, text: string): void;
  /** A new short name for a task, when its work changed. */
  renameTask(taskId: string, name: string): void;
  cancelTurn(taskId: string): Promise<void>;
  startRelay(taskId: string): Promise<void>;
  endRelay(): Promise<void>;
  say(text: string): Promise<void>;
  ask(text: string, options: string[]): Promise<void>;
  audit(type: string, data: Record<string, unknown>): void;
  getState<T>(key: string): T | undefined;
  setState(key: string, value: unknown): void;
}

/** Calls return at once; the Herder works through them one at a time. */
export interface HerderPort {
  ownerMessage(text: string): void;
  ownerAnswer(question: string, answer: string): void;
  event(event: HerderEvent): void;
  stop(): Promise<void>;
}

export type HerderFactory = (host: HerderHost) => HerderPort;
