// The watchdog (docs/spec/04-herder.md §2 "Watchdog"). It raises at most one alarm per reason
// per turn. Handling the alarm is the caller's job (the Herder from plan 008; until then the
// owner is told).

import type { Clock, Timer } from "./clock.ts";
import { CORE_TEXTS, type CoreTexts } from "./texts.ts";

/** Default `watchdogSeconds`. */
export const WATCHDOG_SECONDS = 60;
/** Default `maxQuietMinutes`. */
export const MAX_QUIET_MINUTES = 30;
/** Same tool call with the same input this many times in one turn raises an alarm. */
export const REPEAT_LIMIT = 3;

export type AlarmReason = "repeated-tool-call" | "quiet" | "agent-exited";

export interface Alarm {
  sessionId: string;
  reason: AlarmReason;
  detail: string;
}

export interface WatchdogOptions {
  clock: Clock;
  onAlarm: (alarm: Alarm) => void;
  watchdogSeconds?: number;
  maxQuietMinutes?: number;
  texts?: CoreTexts;
}

interface Watched {
  lastEventAt: number;
  working: boolean;
  waiting: boolean;
  calls: Map<string, number>;
  raised: Set<AlarmReason>;
}

export class Watchdog {
  private readonly sessions = new Map<string, Watched>();
  private readonly opts: WatchdogOptions;
  private timer: Timer | undefined;

  private get texts(): CoreTexts {
    return this.opts.texts ?? CORE_TEXTS.en;
  }

  constructor(opts: WatchdogOptions) {
    this.opts = opts;
  }

  /** Starts watching a session. */
  track(sessionId: string): void {
    this.sessions.set(sessionId, {
      lastEventAt: this.opts.clock.now().getTime(),
      working: false,
      waiting: false,
      calls: new Map(),
      raised: new Set(),
    });
    this.schedule();
  }

  /** A new turn starts: counters and raised alarms reset. */
  turnStarted(sessionId: string): void {
    const w = this.sessions.get(sessionId);
    if (w === undefined) return;
    w.calls.clear();
    w.raised.clear();
    w.working = true;
    w.lastEventAt = this.opts.clock.now().getTime();
  }

  /** The turn ended; quiet time no longer counts. */
  turnEnded(sessionId: string): void {
    const w = this.sessions.get(sessionId);
    if (w !== undefined) w.working = false;
  }

  /**
   * The session waits for the owner. Waiting time is not quiet time: the agent cannot move
   * until the owner answers.
   */
  waiting(sessionId: string, waiting: boolean): void {
    const w = this.sessions.get(sessionId);
    if (w === undefined || w.waiting === waiting) return;
    w.waiting = waiting;
    w.lastEventAt = this.opts.clock.now().getTime();
  }

  /** Any event from the agent. */
  event(sessionId: string): void {
    const w = this.sessions.get(sessionId);
    if (w !== undefined) w.lastEventAt = this.opts.clock.now().getTime();
  }

  /**
   * A new tool call. `key` identifies the call by tool and input (not by call id).
   * @param label Shown in the alarm, e.g. the command.
   */
  toolCall(sessionId: string, key: string, label: string): void {
    const w = this.sessions.get(sessionId);
    if (w === undefined) return;
    this.event(sessionId);
    const n = (w.calls.get(key) ?? 0) + 1;
    w.calls.set(key, n);
    if (n >= REPEAT_LIMIT) {
      this.raise(sessionId, w, "repeated-tool-call", this.texts.repeatedToolCall(n, label));
    }
  }

  /** The agent process exited while the task was not finished. */
  exited(sessionId: string, detail: string): void {
    const w = this.sessions.get(sessionId);
    if (w !== undefined) this.raise(sessionId, w, "agent-exited", detail);
  }

  /** Stops watching a session. */
  untrack(sessionId: string): void {
    this.sessions.delete(sessionId);
    if (this.sessions.size === 0) this.stop();
  }

  stop(): void {
    this.timer?.cancel();
    this.timer = undefined;
  }

  private raise(sessionId: string, w: Watched, reason: AlarmReason, detail: string): void {
    if (w.raised.has(reason)) return;
    w.raised.add(reason);
    this.opts.onAlarm({ sessionId, reason, detail });
  }

  private schedule(): void {
    if (this.timer !== undefined) return;
    const ms = (this.opts.watchdogSeconds ?? WATCHDOG_SECONDS) * 1000;
    this.timer = this.opts.clock.after(ms, () => {
      this.timer = undefined;
      this.check();
      if (this.sessions.size > 0) this.schedule();
    });
  }

  private check(): void {
    const quietMs = (this.opts.maxQuietMinutes ?? MAX_QUIET_MINUTES) * 60_000;
    const now = this.opts.clock.now().getTime();
    for (const [id, w] of this.sessions) {
      if (w.working && !w.waiting && now - w.lastEventAt >= quietMs) {
        const minutes = Math.round((now - w.lastEventAt) / 60_000);
        this.raise(id, w, "quiet", this.texts.quiet(minutes));
      }
    }
  }
}
