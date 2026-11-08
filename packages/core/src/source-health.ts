// Whether the sources AgentHerd watches for the owner still answer (docs/spec/04-herder.md
// "Source health", ADR 0050). A pull request or mail watch that silently stopped is worse than
// none: the owner thinks it is still watching. One failed look is not news; a source that has
// failed for a while is told once, and told again when it works.

import { type HerdContext, say } from "./herd-context.ts";

/** The sources with a health of their own. */
export type SourceId = "github" | "mail";

/** A source failing this long is told to the owner. */
export const SOURCE_DOWN_MINUTES = 30;

const STATE_KEY = "sources.health";

export interface SourceState {
  source: SourceId;
  /** When the current run of failures started. */
  since: string;
  /** The latest error, as the source gave it. */
  message: string;
  /** Whether the owner was told it is down. */
  told: boolean;
}

/** What the owner can do about a source's error, or undefined when it is just unreachable. */
export function sourceHint(source: SourceId, message: string): "missing" | "login" | "offline" {
  const m = message.toLowerCase();
  if (source === "github") {
    if (/enoent|not recognized|not found: gh|command not found/.test(m)) return "missing";
    if (/gh auth login|not logged|authentication|401|bad credentials/.test(m)) return "login";
    return "offline";
  }
  if (/no connected apps|not connected|no active connection|expired|401|unauthor/.test(m)) {
    return "login";
  }
  return "offline";
}

export class SourceHealth {
  private readonly context: () => HerdContext;
  private readonly downMinutes: number;

  /** `ctx` is a getter: the health is part of the context it reads. */
  constructor(ctx: () => HerdContext, downMinutes: number = SOURCE_DOWN_MINUTES) {
    this.context = ctx;
    this.downMinutes = downMinutes;
  }

  private get ctx(): HerdContext {
    return this.context();
  }

  /** Forgets `source` without telling anyone: nothing is watched there any more. */
  clear(source: SourceId): void {
    const all = this.all();
    if (all[source] === undefined) return;
    delete all[source];
    this.save(all);
  }

  /** Sources failing now. */
  list(): SourceState[] {
    return Object.values(this.all());
  }

  /** A look at `source` worked. */
  ok(source: SourceId): void {
    const all = this.all();
    const state = all[source];
    if (state === undefined) return;
    delete all[source];
    this.save(all);
    this.ctx.store.audit("source.up", { source, since: state.since, told: state.told });
    if (state.told) void say(this.ctx, this.ctx.texts.sourceUp(source));
  }

  /** A look at `source` failed with `error`. */
  failed(source: SourceId, error: Error | string): void {
    const message = typeof error === "string" ? error : error.message;
    const { store, clock, texts } = this.ctx;
    const all = this.all();
    const now = clock.now();
    const state = all[source] ?? { source, since: now.toISOString(), message: "", told: false };
    // Each distinct error once in the audit, not every look.
    if (state.message !== message) store.audit(`${source}.error`, { message });
    state.message = message;
    if (!state.told && now.getTime() - Date.parse(state.since) >= this.downMinutes * 60_000) {
      state.told = true;
      store.audit("source.down", { source, since: state.since, message });
      const text = texts.sourceDown(source, sourceHint(source, message), this.downMinutes);
      void say(this.ctx, text, undefined, "alarm");
    }
    all[source] = state;
    this.save(all);
  }

  private all(): Partial<Record<SourceId, SourceState>> {
    return {
      ...(this.ctx.store.getState<Partial<Record<SourceId, SourceState>>>(STATE_KEY) ?? {}),
    };
  }

  private save(all: Partial<Record<SourceId, SourceState>>): void {
    if (Object.keys(all).length === 0) this.ctx.store.deleteState(STATE_KEY);
    else this.ctx.store.setState(STATE_KEY, all);
  }
}
