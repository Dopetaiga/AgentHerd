// The relay: the owner talks straight to one task (docs/spec/04-herder.md).

import type { Timer } from "./clock.ts";
import { type HerdContext, send } from "./herd-context.ts";

/** The active relay, stored in `herd.db` under {@link RELAY_KEY}. */
export interface RelayState {
  taskId: string;
  startedAt: string;
}

export const RELAY_KEY = "relay";
export const RELAY_IDLE_MINUTES = 30;

export class Relay {
  private timer: Timer | undefined;

  private readonly ctx: HerdContext;

  constructor(ctx: HerdContext) {
    this.ctx = ctx;
  }

  /** The active relay, if its task is still open. */
  current(): RelayState | undefined {
    const relay = this.ctx.store.getState<RelayState>(RELAY_KEY);
    if (relay === undefined) return undefined;
    const f = this.ctx.following.get(relay.taskId);
    return f === undefined || f.ended ? undefined : relay;
  }

  /** The stored relay, even if its task has ended. */
  stored(): RelayState | undefined {
    return this.ctx.store.getState<RelayState>(RELAY_KEY);
  }

  /** Drops a relay left over from an earlier run. */
  reset(): void {
    this.ctx.store.deleteState(RELAY_KEY);
  }

  async start(taskId: string): Promise<void> {
    const { ctx } = this;
    const f = ctx.following.get(taskId);
    if (f === undefined || f.ended) {
      await send(ctx, { kind: "text", text: ctx.texts.taskEnded });
      return;
    }
    const current = this.current();
    if (current?.taskId === taskId) return;
    if (current !== undefined) await this.end("another relay started");
    const state: RelayState = { taskId, startedAt: ctx.clock.now().toISOString() };
    ctx.store.setState(RELAY_KEY, state);
    ctx.store.audit("relay.started", { taskId });
    this.touch();
    await send(ctx, { kind: "relay", taskId, taskLabel: f.task.title, active: true });
  }

  async end(why: string): Promise<void> {
    const { ctx } = this;
    const relay = this.stored();
    if (relay === undefined) return;
    ctx.store.deleteState(RELAY_KEY);
    this.timer?.cancel();
    this.timer = undefined;
    ctx.store.audit("relay.ended", { taskId: relay.taskId, why });
    const label = ctx.following.get(relay.taskId)?.task.title ?? relay.taskId;
    await send(ctx, { kind: "relay", taskId: relay.taskId, taskLabel: label, active: false });
  }

  /** Restarts the relay idle timer on every owner message. */
  touch(): void {
    this.timer?.cancel();
    const minutes = this.ctx.opts.relayIdleMinutes ?? RELAY_IDLE_MINUTES;
    this.timer = this.ctx.clock.after(minutes * 60_000, () => {
      this.timer = undefined;
      void this.end(`no message for ${minutes} minutes`);
    });
  }

  /** Cancels the idle timer without ending the relay (on stop). */
  stop(): void {
    this.timer?.cancel();
  }
}
