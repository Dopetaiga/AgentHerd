// Time is injected so reminders and the watchdog can be tested without waiting.

export interface Timer {
  cancel(): void;
}

export interface Clock {
  now(): Date;
  /** Calls `fn` after `ms`. The timer must not keep the process alive. */
  after(ms: number, fn: () => void): Timer;
}

export const systemClock: Clock = {
  now: () => new Date(),
  after(ms, fn) {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return { cancel: () => clearTimeout(handle) };
  },
};

/** A clock for tests. `advance` runs due timers in time order. */
export class FakeClock implements Clock {
  private time: number;
  private timers: { at: number; seq: number; fn: () => void; live: boolean }[] = [];
  private seq = 0;

  constructor(start = "2026-11-04T00:00:00.000Z") {
    this.time = Date.parse(start);
  }

  now(): Date {
    return new Date(this.time);
  }

  after(ms: number, fn: () => void): Timer {
    const timer = { at: this.time + ms, seq: this.seq++, fn, live: true };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.live = false;
      },
    };
  }

  /** Moves time forward and runs every timer that becomes due, including ones they add. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => t.live && t.at <= end)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (due === undefined) break;
      due.live = false;
      this.time = due.at;
      due.fn();
      // Let async work started by the timer run before the next one.
      await new Promise((r) => setImmediate(r));
    }
    this.time = end;
    this.timers = this.timers.filter((t) => t.live);
  }

  pending(): number {
    return this.timers.filter((t) => t.live).length;
  }
}
