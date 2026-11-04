// The pinned task board (docs/spec/05-channels.md §2, ADR 0019). One card, sent and pinned once,
// then updated in place by code. Updates are coalesced: many stage changes within
// `debounceMs` become one update.

import type { BoardView, Channel, MessageRef } from "@agentherd/protocol";
import type { Clock, Timer } from "./clock.ts";
import type { Store } from "./store.ts";
import { sortForBoard, type Task } from "./tasks.ts";

/** Rows on the board; older finished tasks drop off. */
export const BOARD_MAX_ROWS = 20;
/** Default wait before an update is sent. */
export const BOARD_DEBOUNCE_MS = 1000;

export interface BoardOptions {
  channel: Channel;
  store: Store;
  clock: Clock;
  /** Current tasks, read when an update is sent. */
  tasks: () => Task[];
  debounceMs?: number;
}

/**
 * Builds the board view: sorted, at most `BOARD_MAX_ROWS` rows.
 * @param tasks All known tasks.
 */
export function boardView(tasks: readonly Task[]): BoardView {
  return {
    kind: "board",
    rows: sortForBoard(tasks)
      .slice(0, BOARD_MAX_ROWS)
      .map((t) => ({
        taskId: t.id,
        task: t.title,
        stage: t.stage,
        project: t.project,
        agent: t.agent,
        lastReport: t.lastReport,
        updatedAt: t.updatedAt,
      })),
  };
}

export class Board {
  private ref: MessageRef | undefined;
  private timer: Timer | undefined;
  private running: Promise<void> = Promise.resolve();
  private readonly opts: BoardOptions;

  constructor(opts: BoardOptions) {
    this.opts = opts;
  }

  /** Schedules an update. */
  changed(): void {
    if (this.timer !== undefined) return;
    this.timer = this.opts.clock.after(this.opts.debounceMs ?? BOARD_DEBOUNCE_MS, () => {
      this.timer = undefined;
      void this.flush();
    });
  }

  /**
   * Sends the board now: the first time as a new pinned message, later in place. With
   * `resend`, sends a new message and pins it (the owner's `status` command).
   */
  flush(resend = false): Promise<void> {
    this.timer?.cancel();
    this.timer = undefined;
    this.running = this.running.then(() => this.send(resend));
    return this.running;
  }

  stop(): void {
    this.timer?.cancel();
    this.timer = undefined;
  }

  private async send(resend: boolean): Promise<void> {
    const view = boardView(this.opts.tasks());
    const { channel, store } = this.opts;
    try {
      if (this.ref === undefined || resend) {
        this.ref = await channel.send(view);
        await channel.pin(this.ref);
        store.audit("board.sent", { rows: view.rows.length });
      } else {
        await channel.update(this.ref, view);
      }
    } catch (error) {
      store.audit("board.error", { message: (error as Error).message });
    }
  }
}
