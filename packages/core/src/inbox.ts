// Items waiting for the owner (docs/spec/05-channels.md §2). At most one open card per
// session; newer items for the same session wait behind it. Only the bound owner can answer.
// Time passing never decides anything: open items only get reminders.

import type {
  Channel,
  ChannelBinding,
  Decision,
  Inbound,
  Item,
  ItemView,
  MessageRef,
} from "@agentherd/protocol";
import { redact } from "@agentherd/rules";
import type { Clock, Timer } from "./clock.ts";
import type { Store } from "./store.ts";

export const BODY_MAX_LINES = 20;
export const DEFAULT_REMIND_MINUTES = 30;

export type OwnerAnswer = "allow" | "deny";

/** The agent side of an item: answering it, once. */
export interface Answerable {
  /** Returns false when the agent no longer waits (it was cancelled or exited). */
  answer(answer: OwnerAnswer): boolean;
}

interface Entry {
  item: Item;
  target: Answerable;
  reason: string;
  ref?: MessageRef;
  reminder?: Timer;
  closing: boolean;
}

export interface InboxOptions {
  channel: Channel;
  binding: ChannelBinding;
  store: Store;
  clock: Clock;
  remindMinutes?: number;
  secrets?: Record<string, string>;
  /** Called after an item is decided or expired. */
  onClosed?: (item: Item) => void;
}

const OPTIONS: ItemView["options"] = [
  { action: "allow", label: "Allow" },
  { action: "deny", label: "Deny" },
];

/** Card body: the command and the paths, at most 20 lines, redacted. */
/** The agent's own reason for a tool call, e.g. DSH's `rawInput.justification`. */
function justificationOf(rawInput: unknown): string | undefined {
  if (typeof rawInput !== "object" || rawInput === null || !("justification" in rawInput))
    return undefined;
  const value = rawInput.justification;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function itemBody(item: Item, secrets?: Record<string, string>): string {
  const lines: string[] = [];
  if (item.toolCall?.command !== undefined) lines.push(...item.toolCall.command.split("\n"));
  for (const path of item.toolCall?.paths ?? []) lines.push(path);
  if (lines.length === 0) lines.push(...item.body.split("\n"));
  const justification = justificationOf(item.toolCall?.rawInput);
  if (justification !== undefined) lines.push(`Reason: ${justification}`);
  const shown =
    lines.length > BODY_MAX_LINES
      ? [...lines.slice(0, BODY_MAX_LINES - 1), `… ${lines.length - BODY_MAX_LINES + 1} more lines`]
      : lines;
  return redact(shown.join("\n"), secrets);
}

export function itemView(item: Item, reason: string, secrets?: Record<string, string>): ItemView {
  return {
    kind: "item",
    itemId: item.id,
    title: redact(item.title, secrets),
    body: itemBody(item, secrets),
    risk: item.risk,
    options: OPTIONS,
    reason: redact(reason, secrets),
  };
}

export class Inbox {
  private readonly queues = new Map<string, Entry[]>();
  private readonly remindMs: number;

  private readonly opts: InboxOptions;

  constructor(opts: InboxOptions) {
    this.opts = opts;
    this.remindMs = (opts.remindMinutes ?? DEFAULT_REMIND_MINUTES) * 60_000;
  }

  /** Number of items not yet decided, shown or queued. */
  get size(): number {
    let n = 0;
    for (const q of this.queues.values()) n += q.length;
    return n;
  }

  async add(item: Item, target: Answerable, reason: string): Promise<void> {
    const queue = this.queues.get(item.sessionId) ?? [];
    this.queues.set(item.sessionId, queue);
    const entry: Entry = { item, target, reason, closing: false };
    queue.push(entry);
    if (queue.length === 1) await this.show(entry);
  }

  async handle(inbound: Inbound): Promise<void> {
    const { store, binding } = this.opts;
    if (inbound.from !== binding.ownerId) {
      store.audit("inbound.dropped", {
        reason: "not-owner",
        from: inbound.from,
        kind: inbound.kind,
      });
      return;
    }
    if (inbound.kind !== "action") {
      store.audit("inbound.ignored", { reason: "no-herder-in-m1", text: inbound.text });
      return;
    }
    const entry = this.shown(inbound.target);
    if (entry === undefined || entry.closing) {
      store.audit("inbound.dropped", { reason: "not-open", target: inbound.target });
      return;
    }
    if (inbound.action !== "allow" && inbound.action !== "deny") {
      store.audit("inbound.dropped", { reason: "unknown-action", action: inbound.action });
      return;
    }
    await this.decide(entry, inbound.action, binding.ownerId);
  }

  /** The agent stopped waiting (exit, cancel, end of turn): its open items expire. */
  async expireSession(sessionId: string, why: string): Promise<void> {
    const queue = this.queues.get(sessionId);
    if (queue === undefined) return;
    this.queues.delete(sessionId);
    for (const entry of queue) {
      if (entry.closing) continue;
      entry.closing = true;
      await this.finish(entry, "expired", `Expired: ${why}`);
    }
  }

  async stop(): Promise<void> {
    for (const sessionId of [...this.queues.keys()]) {
      await this.expireSession(sessionId, "AgentHerd stopped");
    }
  }

  private shown(itemId: string): Entry | undefined {
    for (const queue of this.queues.values()) {
      const head = queue[0];
      if (head !== undefined && head.item.id === itemId && head.ref !== undefined) return head;
    }
    return undefined;
  }

  private async show(entry: Entry): Promise<void> {
    const { channel, store, secrets } = this.opts;
    const ref = await channel.send(itemView(entry.item, entry.reason, secrets));
    entry.ref = ref;
    store.updateItem(entry.item.id, { messageRef: ref });
    store.audit("item.sent", { itemId: entry.item.id });
    this.scheduleReminder(entry);
  }

  private scheduleReminder(entry: Entry): void {
    entry.reminder = this.opts.clock.after(this.remindMs, () => {
      if (entry.closing) return;
      const { channel, store, secrets } = this.opts;
      const text = `Still waiting for you: ${redact(entry.item.title, secrets)}`;
      void channel
        .send({ kind: "text", text })
        .then(() => store.audit("item.reminded", { itemId: entry.item.id }))
        .catch((error: Error) =>
          store.audit("channel.error", { op: "remind", message: error.message }),
        );
      this.scheduleReminder(entry);
    });
  }

  private async decide(entry: Entry, answer: OwnerAnswer, ownerId: string): Promise<void> {
    entry.closing = true;
    const { store, clock } = this.opts;
    if (!entry.target.answer(answer)) {
      await this.finish(entry, "expired", "Expired: the agent stopped waiting");
      await this.next(entry.item.sessionId);
      return;
    }
    const decision: Decision = {
      itemId: entry.item.id,
      action: answer,
      confidence: 1,
      risk: entry.item.risk,
      source: "human",
      reason: "owner",
      precedents: [],
    };
    store.insertDecision(decision, { ownerId, createdAt: clock.now().toISOString() });
    await this.finish(entry, "decided", answer === "allow" ? "Allowed by you" : "Denied by you");
    await this.next(entry.item.sessionId);
  }

  private async finish(entry: Entry, state: "decided" | "expired", final: string): Promise<void> {
    const { store, channel, clock, secrets } = this.opts;
    entry.reminder?.cancel();
    store.updateItem(entry.item.id, { state, decidedAt: clock.now().toISOString() });
    store.audit(`item.${state}`, { itemId: entry.item.id, final });
    if (entry.ref !== undefined) {
      const view: ItemView = { ...itemView(entry.item, entry.reason, secrets), options: [], final };
      try {
        await channel.update(entry.ref, view);
      } catch (error) {
        store.audit("channel.error", { op: "update", message: (error as Error).message });
      }
    }
    this.opts.onClosed?.({ ...entry.item, state });
  }

  private async next(sessionId: string): Promise<void> {
    const queue = this.queues.get(sessionId);
    if (queue === undefined) return;
    queue.shift();
    const head = queue[0];
    if (head === undefined) {
      this.queues.delete(sessionId);
      return;
    }
    try {
      await this.show(head);
    } catch (error) {
      this.opts.store.audit("channel.error", { op: "send", message: (error as Error).message });
    }
  }
}
