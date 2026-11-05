// The Herder: one resident session on a light model (docs/spec/04-herder.md §1, ADR 0018).

import type { HerderEvent, HerderHost, HerderPort } from "@agentherd/core";
import { Agent, type AgentMessage, type StreamFn } from "@agentherd/herder-loop";
import { guardCheck } from "@agentherd/rules";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { TierPlacement } from "./model-guide.ts";
import { eventsPrompt, ownerAnswerPrompt, ownerMessagePrompt, systemPrompt } from "./prompt.ts";
import { herderTools, resolveProject, type TurnContext } from "./tools.ts";

export const HERDER_STATE_KEY = "herder.messages";
export const MAX_SAVED_MESSAGES = 200;

export interface HerderOptions {
  host: HerderHost;
  model: Model<Api>;
  streamFn: StreamFn;
  getApiKey?: (provider: string) => string | undefined | Promise<string | undefined>;
  maxSavedMessages?: number;
  /** The model tiers, for picking and swapping a task's model (ADR 0028). Read on each use. */
  modelTiers?: () => TierPlacement;
}

type Job = { kind: "owner"; text: string } | { kind: "answer"; question: string; answer: string };

/** Events kept for the next owner turn; older ones are dropped. */
export const MAX_HELD_EVENTS = 10;

export class Herder implements HerderPort {
  private readonly host: HerderHost;
  private readonly agent: Agent;
  private readonly jobs: Job[] = [];
  private events: HerderEvent[] = [];
  private running: Promise<void> | undefined;
  private stopped = false;
  private turn: TurnContext = { kind: "owner", ownerText: "", asked: false, notified: false };
  /** The owner message an answer belongs to. */
  private lastOwnerText = "";
  private readonly maxSaved: number;

  constructor(opts: HerderOptions) {
    this.host = opts.host;
    this.maxSaved = opts.maxSavedMessages ?? MAX_SAVED_MESSAGES;
    const saved = this.host.getState<AgentMessage[]>(HERDER_STATE_KEY) ?? [];
    this.agent = new Agent({
      streamFn: opts.streamFn,
      ...(opts.getApiKey === undefined ? {} : { getApiKey: opts.getApiKey }),
      beforeToolCall: async ({ toolCall, args }) => this.check(toolCall.name, args),
      initialState: {
        systemPrompt: systemPrompt(this.host.locale),
        model: opts.model,
        thinkingLevel: "off",
        tools: herderTools(this.host, () => this.turn, opts.modelTiers),
        messages: saved,
      },
    });
  }

  ownerMessage(text: string): void {
    this.enqueue({ kind: "owner", text });
  }

  ownerAnswer(question: string, answer: string): void {
    this.enqueue({ kind: "answer", question, answer });
  }

  /**
   * Reports and alarms already reach the owner by themselves, so an event starts no turn: the
   * Herder only repeated them. They go with the owner's next message as context.
   */
  event(event: HerderEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_HELD_EVENTS) this.events.shift();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.jobs.length = 0;
    this.agent.abort();
    await this.running;
  }

  /** Resolves when every queued job has run. For tests. */
  async idle(): Promise<void> {
    while (this.running !== undefined) await this.running;
  }

  private enqueue(job: Job): void {
    if (this.stopped) return;
    this.jobs.push(job);
    if (this.running === undefined) {
      this.running = this.drain().finally(() => {
        this.running = undefined;
      });
    }
  }

  private async drain(): Promise<void> {
    for (let job = this.jobs.shift(); job !== undefined && !this.stopped; job = this.jobs.shift()) {
      await this.runJob(job);
    }
  }

  private async runJob(job: Job): Promise<void> {
    let prompt: string;
    if (job.kind === "owner") {
      this.lastOwnerText = job.text;
      this.turn = { kind: "owner", ownerText: job.text, asked: false, notified: false };
      prompt = ownerMessagePrompt(job.text);
    } else {
      const text = `${this.lastOwnerText}\n${job.answer}`;
      this.turn = { kind: "answer", ownerText: text, asked: false, notified: false };
      prompt = ownerAnswerPrompt(job.question, job.answer);
    }
    if (this.events.length > 0) {
      prompt = `${eventsPrompt(this.events)}\n\n${prompt}`;
      this.events = [];
    }
    this.host.audit("herder.turn", { kind: job.kind });
    const before = this.agent.state.messages.length;
    try {
      await this.agent.prompt(prompt);
    } catch (error) {
      await this.fail(job, (error as Error).message, before);
      return;
    }
    const last = this.agent.state.messages.at(-1);
    if (
      last?.role === "assistant" &&
      (last.stopReason === "error" || last.stopReason === "aborted")
    ) {
      await this.fail(job, last.errorMessage ?? last.stopReason, before);
      return;
    }
    if (!this.turn.asked && last?.role === "assistant") {
      const text = last.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("")
        .trim();
      if (text !== "") await this.host.say(text);
    }
    this.save();
  }

  /** A failed turn leaves no trace in the session; the owner gets a plain message. */
  private async fail(job: Job, message: string, before: number): Promise<void> {
    this.agent.state.messages = this.agent.state.messages.slice(0, before);
    this.host.audit("herder.error", { kind: job.kind, message });
    if (!this.stopped) await this.host.say(this.host.texts.herderFailed(message));
    this.save();
  }

  /** Guard list on every tool call (docs/spec/06-security.md). A hit blocks the call and tells the owner. */
  private async check(
    name: string,
    args: unknown,
  ): Promise<{ block: true; reason: string } | undefined> {
    this.host.audit("herder.tool", { name, args: args as Record<string, unknown> });
    if (name !== "session_start") return undefined;
    const project = (args as { project?: unknown }).project;
    if (typeof project !== "string") return undefined;
    let cwd: string;
    try {
      cwd = resolveProject(this.host, project);
    } catch {
      return undefined; // The tool itself reports an unknown project.
    }
    const result = guardCheck(
      { kind: "session_start", title: "session_start", paths: [cwd] },
      { cwd, home: this.host.userHome },
    );
    if (!result.hit) return undefined;
    this.host.audit("herder.guard", { name, id: result.id, reason: result.reason });
    await this.host.say(this.host.texts.herderGuardHit(cwd, result.reason ?? result.id ?? ""));
    return { block: true, reason: `blocked by the guard list: ${result.reason}` };
  }

  /** Saves the session, cut at a user message so tool calls keep their results. */
  private save(): void {
    let messages = this.agent.state.messages.filter((m) => m.role !== "system");
    if (messages.length > this.maxSaved) {
      let start = messages.length - this.maxSaved;
      while (start < messages.length && messages[start]?.role !== "user") start++;
      messages = messages.slice(start);
    }
    this.host.setState(HERDER_STATE_KEY, messages);
  }
}
