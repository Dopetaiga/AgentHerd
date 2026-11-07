// An in-memory Channel for tests. It records what AgentHerd sends and lets a test act as the
// owner (or as someone else) through `tap` and `say`.

import type {
  Channel,
  ChannelBinding,
  ChannelCapability,
  InboundSink,
  MessageRef,
  SetupUI,
  View,
} from "@agentherd/protocol";

export interface SentMessage {
  ref: MessageRef;
  /** The latest view; `history` keeps every version. */
  view: View;
  history: View[];
  pinned: boolean;
}

export class FakeChannel implements Channel {
  readonly id = "fake";
  readonly capabilities: ChannelCapability[] = ["buttons", "free-text", "update-message", "pin"];
  readonly messages: SentMessage[] = [];
  private sink: InboundSink | null = null;
  private next = 1;
  private waiters: { match: (m: SentMessage) => boolean; resolve: (m: SentMessage) => void }[] = [];

  private readonly ownerId: string;

  constructor(ownerId = "owner") {
    this.ownerId = ownerId;
  }

  async setup(ui: SetupUI): Promise<ChannelBinding> {
    ui.showStatus("fake channel ready");
    return { channelId: this.id, ownerId: this.ownerId, data: {} };
  }

  async start(_binding: ChannelBinding, sink: InboundSink): Promise<void> {
    this.sink = sink;
  }

  async stop(): Promise<void> {
    this.sink = null;
  }

  async send(view: View): Promise<MessageRef> {
    const ref = { channelId: this.id, id: `m${this.next++}` };
    const message: SentMessage = { ref, view, history: [view], pinned: false };
    this.messages.push(message);
    this.notify(message);
    return ref;
  }

  async update(ref: MessageRef, view: View): Promise<void> {
    const message = this.find(ref);
    message.view = view;
    message.history.push(view);
    this.notify(message);
  }

  async pin(ref: MessageRef): Promise<void> {
    this.find(ref).pinned = true;
  }

  /** Taps a button on an item card. */
  async tap(target: string, action: string, from = this.ownerId): Promise<void> {
    await this.deliver({ kind: "action", target, action, from });
  }

  /** Sends a text message to AgentHerd. */
  async say(text: string, from = this.ownerId): Promise<void> {
    await this.deliver({ kind: "message", text, from });
  }

  /** Sends a text message that replies to one AgentHerd sent. */
  async reply(to: MessageRef, text: string, from = this.ownerId): Promise<void> {
    await this.deliver({ kind: "message", text, from, replyTo: to });
  }

  /** Messages whose current view has the given kind. */
  ofKind<K extends View["kind"]>(kind: K): (SentMessage & { view: Extract<View, { kind: K }> })[] {
    return this.messages.filter((m) => m.view.kind === kind) as (SentMessage & {
      view: Extract<View, { kind: K }>;
    })[];
  }

  /** Resolves with the first message (sent or updated, now or later) that matches. */
  waitFor(match: (m: SentMessage) => boolean): Promise<SentMessage> {
    const found = this.messages.find(match);
    if (found !== undefined) return Promise.resolve(found);
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  private async deliver(inbound: Parameters<InboundSink>[0]): Promise<void> {
    if (this.sink === null) throw new Error("fake channel is not started");
    await this.sink(inbound);
  }

  private find(ref: MessageRef): SentMessage {
    const message = this.messages.find((m) => m.ref.id === ref.id);
    if (message === undefined) throw new Error(`unknown message ${ref.id}`);
    return message;
  }

  private notify(message: SentMessage): void {
    // Resolve after the current send/update returns, as a real channel would.
    setImmediate(() => this.resolveWaiters(message));
  }

  private resolveWaiters(message: SentMessage): void {
    const ready = this.waiters.filter((w) => w.match(message));
    this.waiters = this.waiters.filter((w) => !w.match(message));
    for (const w of ready) w.resolve(message);
  }
}
