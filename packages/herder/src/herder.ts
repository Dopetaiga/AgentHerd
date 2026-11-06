// The Herder: one resident session on a light model (docs/spec/04-herder.md §1, ADR 0018).

import type { HerderEvent, HerderHost, HerderPort, OwnerImage } from "@agentherd/core";
import { Agent, type AgentMessage, type StreamFn } from "@agentherd/herder-loop";
import { guardCheck } from "@agentherd/rules";
import type { Api, Model } from "@earendil-works/pi-ai";
import { errorKind, HELD_RETRY_MS, RETRY_DELAYS_MS } from "./errors.ts";
import { memorySnapshot, memoryTools, recallBlock } from "./memory.ts";
import type { TierPlacement } from "./model-guide.ts";
import { eventsPrompt, ownerAnswerPrompt, ownerMessagePrompt, systemPrompt } from "./prompt.ts";
import { herderTools, otherOption, pathsIn, resolveProject, type TurnContext } from "./tools.ts";

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
  /** `service/model` of `model`, for telling the owner about a switch. */
  modelRef?: string;
  /** Other models to run on when this one keeps failing, best first (ADR 0037). */
  fallbacks?: () => HerderModel[];
  /** Waits before each retry of the same model. */
  retryDelaysMs?: number[];
  /** How often a held message is tried again. */
  heldRetryMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Clock in ms, for tests. */
  now?: () => number;
}

/** A model the Herder can run on. */
export interface HerderModel {
  ref: string;
  model: Model<Api>;
  apiKey?: string;
}

type Job = (
  | { kind: "owner"; text: string; images: OwnerImage[] }
  | { kind: "answer"; question: string; answer: string }
) & { recorded?: boolean };

type Attempt = { ok: true } | { ok: false; message: string; acted: boolean };

/** A pause after which the memory in the system prompt is rebuilt. */
export const MEMORY_REFRESH_MS = 60 * 60_000;

/** Events kept for the next owner turn; older ones are dropped. */
export const MAX_HELD_EVENTS = 10;

export class Herder implements HerderPort {
  private readonly host: HerderHost;
  private readonly agent: Agent;
  private readonly jobs: Job[] = [];
  private events: HerderEvent[] = [];
  private running: Promise<void> | undefined;
  private stopped = false;
  private turn: TurnContext = {
    kind: "owner",
    ownerText: "",
    typedText: "",
    images: [],
    asked: false,
    notified: false,
    pickedDirs: [],
  };
  /** The owner message an answer belongs to. */
  private lastOwnerText = "";
  private lastOwnerImages: OwnerImage[] = [];
  /** Whether the model reads images; otherwise it gets where they are saved. */
  private readonly seesImages: boolean;
  private readonly maxSaved: number;
  private current: HerderModel;
  private readonly fallbacks: () => HerderModel[];
  private readonly delays: number[];
  private readonly heldRetryMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** A message every model failed on; it runs before anything else (ADR 0037). */
  private held: Job | undefined;
  private heldTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;
  /** When the last turn ran; after a long pause the memory in the system prompt is rebuilt. */
  private lastTurnAt = 0;

  constructor(opts: HerderOptions) {
    this.host = opts.host;
    this.current = { ref: opts.modelRef ?? opts.model.id, model: opts.model };
    this.fallbacks = opts.fallbacks ?? (() => []);
    this.delays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
    this.heldRetryMs = opts.heldRetryMs ?? HELD_RETRY_MS;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const ownKey = opts.getApiKey;
    this.maxSaved = opts.maxSavedMessages ?? MAX_SAVED_MESSAGES;
    this.seesImages = opts.model.input.includes("image");
    this.now = opts.now ?? (() => Date.now());
    const saved = this.host.getState<AgentMessage[]>(HERDER_STATE_KEY) ?? [];
    this.agent = new Agent({
      streamFn: opts.streamFn,
      getApiKey: async (provider) => this.current.apiKey ?? (await ownKey?.(provider)),
      beforeToolCall: async ({ toolCall, args }) => this.check(toolCall.name, args),
      initialState: {
        systemPrompt: this.fullSystemPrompt(),
        model: opts.model,
        thinkingLevel: "off",
        tools: [
          ...herderTools(this.host, () => this.turn, opts.modelTiers),
          ...(this.host.memory === undefined ? [] : memoryTools(this.host.memory, () => this.turn)),
        ],
        messages: saved,
      },
    });
  }

  ownerMessage(text: string, images: OwnerImage[] = []): void {
    this.enqueue({ kind: "owner", text, images });
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

  /** The owner tapped 「重试」, or the held timer fired: run the held message now. */
  retry(): void {
    const job = this.held;
    if (job === undefined || this.stopped) return;
    this.held = undefined;
    if (this.heldTimer !== undefined) clearTimeout(this.heldTimer);
    this.heldTimer = undefined;
    this.jobs.unshift(job);
    this.kick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heldTimer !== undefined) clearTimeout(this.heldTimer);
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
    // A new message is a good moment to try the held one again; it keeps its place first.
    if (this.held !== undefined) {
      this.retry();
      return;
    }
    this.kick();
  }

  private kick(): void {
    if (this.running === undefined) {
      this.running = this.drain().finally(() => {
        this.running = undefined;
      });
    }
  }

  private async drain(): Promise<void> {
    for (let job = this.jobs.shift(); job !== undefined && !this.stopped; job = this.jobs.shift()) {
      await this.runJob(job);
      if (this.held !== undefined) return; // Later messages wait behind the held one.
    }
  }

  private async runJob(job: Job): Promise<void> {
    let prompt: string;
    let images: OwnerImage[] = [];
    if (job.kind === "owner") {
      images = job.images;
      this.lastOwnerText = job.text;
      this.lastOwnerImages = images;
      this.turn = {
        kind: "owner",
        ownerText: job.text,
        typedText: job.text,
        images,
        asked: false,
        notified: false,
        pickedDirs: pathsIn(job.text, this.host.userHome),
      };
      if (!job.recorded) this.host.recordTurn("owner", job.text);
      prompt = ownerMessagePrompt(job.text, images, this.host.texts);
      const recall = this.host.memory === undefined ? "" : recallBlock(this.host.memory, job.text);
      if (recall !== "") prompt = `${prompt}\n\n${recall}`;
    } else {
      const text = `${this.lastOwnerText}\n${job.answer}`;
      this.turn = {
        kind: "answer",
        ownerText: text,
        typedText: this.lastOwnerText,
        images: this.lastOwnerImages,
        asked: false,
        notified: false,
        // A picked button is a folder the owner chose; their earlier words may name one too.
        pickedDirs: pathsIn(`${this.lastOwnerText}\n ${job.answer}`, this.host.userHome),
      };
      if (!job.recorded) this.host.recordTurn("answer", job.answer);
      prompt = ownerAnswerPrompt(
        job.question,
        job.answer,
        job.answer.trim() === otherOption(this.host.locale),
      );
    }
    job.recorded = true;
    if (this.events.length > 0) {
      for (const e of this.events) this.host.recordTurn("event", `${e.title}: ${e.text}`, e.taskId);
      prompt = `${eventsPrompt(this.events)}\n\n${prompt}`;
      this.events = [];
    }
    this.refreshMemory();
    this.host.audit("herder.turn", { kind: job.kind });
    const done = await this.runWithRetries(job, prompt, images);
    if (!done) return;
    const last = this.agent.state.messages.at(-1);
    if (!this.turn.asked && last?.role === "assistant") {
      const text = last.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("")
        .trim();
      if (text !== "") {
        this.host.recordTurn("herder", text);
        await this.host.say(text);
      }
    }
    this.save();
  }

  /**
   * Runs the turn (ADR 0037): transient errors retry the same model after each delay, then each
   * fallback model once. A key, balance or request error is not retried. When nothing works the
   * message is held and the owner told; it runs again on 「重试」, the next message or a timer.
   * A turn that already did something (a tool ran) is never run again: that could start a task twice.
   * @returns whether the turn finished.
   */
  private async runWithRetries(job: Job, prompt: string, images: OwnerImage[]): Promise<boolean> {
    let result = await this.attempt(prompt, images);
    if (result.ok) return true;
    const first = result.message;
    if (!result.acted && errorKind(first) === "transient") {
      for (const delay of this.delays) {
        if (this.stopped) return false;
        this.host.audit("herder.retry", { kind: job.kind, message: result.message, delay });
        await this.sleep(delay);
        if (this.stopped) return false;
        result = await this.attempt(prompt, images);
        if (result.ok || result.acted || errorKind(result.message) === "fatal") break;
      }
    }
    if (!result.ok && !result.acted) {
      for (const next of this.fallbacks().filter((m) => m.ref !== this.current.ref)) {
        if (this.stopped) return false;
        const from = this.current;
        this.current = next;
        this.agent.state.model = next.model;
        result = await this.attempt(prompt, images);
        if (result.ok) {
          this.host.audit("herder.model-switched", { from: from.ref, to: next.ref, why: first });
          await this.host.alert(this.host.texts.herderSwitched(next.ref, first), false);
          return true;
        }
        if (result.acted) break;
        this.current = from;
        this.agent.state.model = from.model;
      }
    }
    if (result.ok) return true;
    this.host.audit("herder.error", { kind: job.kind, message: result.message });
    if (this.stopped) return false;
    if (result.acted || errorKind(result.message) === "fatal") {
      await this.host.alert(this.host.texts.herderFailed(result.message), false);
      return false;
    }
    this.held = job;
    this.heldTimer = setTimeout(() => this.retry(), this.heldRetryMs);
    this.heldTimer.unref?.();
    await this.host.alert(this.host.texts.herderHeld(result.message), true);
    return false;
  }

  private fullSystemPrompt(): string {
    const base = systemPrompt(this.host.locale);
    const snapshot = this.host.memory === undefined ? "" : memorySnapshot(this.host.memory);
    return snapshot === "" ? base : `${base}\n\n${snapshot}`;
  }

  /**
   * The system prompt keeps the memory as it was when the conversation started, so the prompt
   * cache holds. After {@link MEMORY_REFRESH_MS} without a turn it is rebuilt with what was learnt.
   */
  private refreshMemory(): void {
    const now = this.now();
    const stale = this.lastTurnAt !== 0 && now - this.lastTurnAt >= MEMORY_REFRESH_MS;
    this.lastTurnAt = now;
    if (!stale || this.host.memory === undefined) return;
    const first = this.agent.state.messages[0];
    if (first?.role !== "system") return;
    const prompt = this.fullSystemPrompt();
    if (first.content === prompt) return;
    this.agent.state.messages = [
      { ...first, content: prompt },
      ...this.agent.state.messages.slice(1),
    ];
  }

  /** One try. A failed try leaves no trace in the session. */
  private async attempt(prompt: string, images: OwnerImage[]): Promise<Attempt> {
    const before = this.agent.state.messages.length;
    let message: string | undefined;
    try {
      if (this.seesImages && images.length > 0) {
        await this.agent.prompt(
          prompt,
          images.map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType })),
        );
      } else {
        await this.agent.prompt(prompt);
      }
      const last = this.agent.state.messages.at(-1);
      if (
        last?.role === "assistant" &&
        (last.stopReason === "error" || last.stopReason === "aborted")
      ) {
        message = last.errorMessage ?? last.stopReason;
      }
    } catch (error) {
      message = (error as Error).message;
    }
    if (message === undefined) return { ok: true };
    const added = this.agent.state.messages.slice(before);
    const acted = added.some((m) => m.role === "toolResult");
    this.agent.state.messages = this.agent.state.messages.slice(0, before);
    this.save();
    return { ok: false, message, acted };
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
    // Images are seen once; the text keeps where they are saved. Base64 in every later turn
    // would cost far more than it helps.
    this.agent.state.messages = this.agent.state.messages.map(withoutImages);
    let messages = this.agent.state.messages.filter((m) => m.role !== "system");
    if (messages.length > this.maxSaved) {
      let start = messages.length - this.maxSaved;
      while (start < messages.length && messages[start]?.role !== "user") start++;
      messages = messages.slice(start);
    }
    this.host.setState(HERDER_STATE_KEY, messages);
  }
}

/** Seen once; without this note the model later reads only the path and thinks it never saw it. */
export const IMAGE_SEEN_NOTE =
  "[You saw the image(s) of this message when it arrived; they are no longer attached. Each is still saved at the path above. Ask the owner to send it again if you need to look again.]";

function withoutImages(m: AgentMessage): AgentMessage {
  if (m.role !== "user" || typeof m.content === "string") return m;
  if (!m.content.some((c) => c.type === "image")) return m;
  return {
    ...m,
    content: [
      ...m.content.filter((c) => c.type !== "image"),
      { type: "text", text: IMAGE_SEEN_NOTE },
    ],
  };
}
