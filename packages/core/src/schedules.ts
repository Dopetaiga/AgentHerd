// What the Herder does at set times (ADR 0055). The owner asks the Herder in chat ("每天 9 点看看
// PI-Desktop 有没有新 issue"); the Herder saves it here and it holds at once. At the time the saved
// words come back to the Herder as a turn of their own, which may answer, start a task or say
// nothing. Only an owner's message can make or change one: nothing a task, a web page or a mail
// says can give the Herder work at set times.
import { randomUUID } from "node:crypto";
import type { Clock, Timer } from "./clock.ts";
import type { HerdContext } from "./herd-context.ts";

/** Schedules at most; asking for more is refused. */
export const SCHEDULES_MAX = 20;
/** The shortest and longest gap of an "every" schedule. */
export const EVERY_HOURS_MIN = 1;
export const EVERY_HOURS_MAX = 24 * 7;
/** How often due schedules are looked for. Long timers are late after the Mac slept. */
export const SCHEDULE_TICK_MS = 60_000;
const ABOUT_MAX = 60;
const PROMPT_MAX = 2000;

/** When a schedule runs, in the Mac's local time. Days are 1 (Monday) to 7 (Sunday). */
export type ScheduleWhen =
  | { kind: "daily"; at: string; days?: number[] }
  | { kind: "every"; hours: number }
  | { kind: "once"; at: string };

export interface Schedule {
  id: string;
  /** A short name in the owner's words, e.g. 「早上看 PI-Desktop 新 issue」. */
  about: string;
  /** What the Herder does at the time, as the owner asked it. */
  prompt: string;
  when: ScheduleWhen;
  paused: boolean;
  createdAt: string;
  /** Next run (ISO); missing for a paused schedule. */
  nextAt?: string;
  lastAt?: string;
}

export interface ScheduleInput {
  about: string;
  prompt: string;
  when: ScheduleWhen;
}

export interface SchedulePatch {
  about?: string;
  prompt?: string;
  when?: ScheduleWhen;
  paused?: boolean;
}

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const MOMENT = /^(\d{4})-(\d{2})-(\d{2})[ T]([01]?\d|2[0-3]):([0-5]\d)$/;

/** Throws when `when` cannot be run; returns it tidied. */
export function checkWhen(when: ScheduleWhen): ScheduleWhen {
  if (when.kind === "daily") {
    if (!CLOCK.test(when.at)) throw new Error(`at must be HH:MM, not "${when.at}"`);
    const days = when.days === undefined ? [] : [...new Set(when.days)].sort((a, b) => a - b);
    if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      throw new Error("days are 1 (Monday) to 7 (Sunday)");
    }
    const at = when.at.padStart(5, "0");
    return days.length === 0 || days.length === 7
      ? { kind: "daily", at }
      : { kind: "daily", at, days };
  }
  if (when.kind === "every") {
    const h = when.hours;
    if (!Number.isFinite(h) || h < EVERY_HOURS_MIN || h > EVERY_HOURS_MAX) {
      throw new Error(`hours must be ${EVERY_HOURS_MIN} to ${EVERY_HOURS_MAX}`);
    }
    return { kind: "every", hours: h };
  }
  if (when.kind === "once") {
    if (localMoment(when.at) === undefined) {
      throw new Error(`at must be "YYYY-MM-DD HH:MM", not "${when.at}"`);
    }
    return { kind: "once", at: when.at.replace("T", " ") };
  }
  throw new Error('when.kind must be "daily", "every" or "once"');
}

function localMoment(text: string): Date | undefined {
  const m = MOMENT.exec(text.trim());
  if (m === null) return undefined;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  return date.getMonth() === mo - 1 && date.getDate() === d ? date : undefined;
}

/** 1 (Monday) to 7 (Sunday). */
function isoDay(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

/** The first run strictly after `after`; undefined when there is none (a past "once"). */
export function nextRun(when: ScheduleWhen, after: Date): Date | undefined {
  if (when.kind === "every") return new Date(after.getTime() + when.hours * 3_600_000);
  if (when.kind === "once") {
    const at = localMoment(when.at);
    return at !== undefined && at > after ? at : undefined;
  }
  const [h, m] = when.at.split(":").map(Number) as [number, number];
  for (let i = 0; i <= 7; i++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + i, h, m);
    if (day <= after) continue;
    if (when.days === undefined || when.days.includes(isoDay(day))) return day;
  }
  return undefined;
}

/** The time of a schedule in English, for the Herder (it tells the owner in their language). */
export function describeWhen(when: ScheduleWhen): string {
  if (when.kind === "every") return `every ${when.hours} hour${when.hours === 1 ? "" : "s"}`;
  if (when.kind === "once") return `once at ${when.at}`;
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days =
    when.days === undefined ? "every day" : when.days.map((d) => names[d - 1]).join(", ");
  return `${days} at ${when.at}`;
}

function tidy(text: string, max: number, what: string): string {
  const t = text.trim();
  if (t === "") throw new Error(`${what} is empty`);
  if (t.length > max) throw new Error(`${what} is over ${max} characters`);
  return t;
}

export class Schedules {
  private readonly ctx: HerdContext;
  private readonly clock: Clock;
  private timer: Timer | undefined;
  private running = false;

  constructor(ctx: HerdContext) {
    this.ctx = ctx;
    this.clock = ctx.clock;
  }

  start(): void {
    this.running = true;
    // Missed while AgentHerd was off or the Mac slept: run once now, not once per missed time.
    this.tick();
  }

  stop(): void {
    this.running = false;
    this.timer?.cancel();
    this.timer = undefined;
  }

  list(): Schedule[] {
    return this.ctx.store.schedules();
  }

  add(input: ScheduleInput): Schedule {
    const { store } = this.ctx;
    if (store.schedules().length >= SCHEDULES_MAX) {
      throw new Error(`at most ${SCHEDULES_MAX} schedules; remove one first`);
    }
    const when = checkWhen(input.when);
    const now = this.clock.now();
    const next = nextRun(when, now);
    if (next === undefined) throw new Error(`${describeWhen(when)} is already past`);
    const schedule: Schedule = {
      id: randomUUID(),
      about: tidy(input.about, ABOUT_MAX, "about"),
      prompt: tidy(input.prompt, PROMPT_MAX, "prompt"),
      when,
      paused: false,
      createdAt: now.toISOString(),
      nextAt: next.toISOString(),
    };
    store.saveSchedule(schedule);
    store.audit("schedule.added", {
      id: schedule.id,
      about: schedule.about,
      when: describeWhen(when),
    });
    this.arm();
    return schedule;
  }

  /** Changes a schedule; throws when there is none. */
  change(id: string, patch: SchedulePatch): Schedule {
    const { store } = this.ctx;
    const old = store.schedules().find((s) => s.id === id);
    if (old === undefined) throw new Error("no such schedule");
    const when = patch.when === undefined ? old.when : checkWhen(patch.when);
    const paused = patch.paused ?? old.paused;
    const changed: Schedule = {
      ...old,
      about: patch.about === undefined ? old.about : tidy(patch.about, ABOUT_MAX, "about"),
      prompt: patch.prompt === undefined ? old.prompt : tidy(patch.prompt, PROMPT_MAX, "prompt"),
      when,
      paused,
    };
    delete changed.nextAt;
    if (!paused) {
      // Keep the coming time unless when it runs changed or it was paused.
      const keep = patch.when === undefined && !old.paused ? old.nextAt : undefined;
      const next = keep ?? nextRun(when, this.clock.now())?.toISOString();
      if (next === undefined) throw new Error(`${describeWhen(when)} is already past`);
      changed.nextAt = next;
    }
    store.saveSchedule(changed);
    store.audit("schedule.changed", { id, about: changed.about, paused });
    this.arm();
    return changed;
  }

  /** Removes a schedule; false when there is none. */
  remove(id: string): boolean {
    const { store } = this.ctx;
    const old = store.schedules().find((s) => s.id === id);
    if (old === undefined) return false;
    store.deleteSchedule(id);
    store.audit("schedule.removed", { id, about: old.about });
    return true;
  }

  /** Runs every schedule that is due, then waits for the next look. */
  tick(): void {
    this.timer?.cancel();
    this.timer = undefined;
    if (!this.running) return;
    const now = this.clock.now();
    for (const schedule of this.ctx.store.schedules()) {
      if (schedule.paused || schedule.nextAt === undefined) continue;
      if (new Date(schedule.nextAt) > now) continue;
      this.fire(schedule, now);
    }
    this.arm();
  }

  private fire(schedule: Schedule, now: Date): void {
    const { store } = this.ctx;
    const next = nextRun(schedule.when, now);
    if (next === undefined) {
      store.deleteSchedule(schedule.id);
      store.audit("schedule.done", { id: schedule.id, about: schedule.about });
    } else {
      store.saveSchedule({ ...schedule, lastAt: now.toISOString(), nextAt: next.toISOString() });
    }
    const herder = this.ctx.herder();
    if (herder?.scheduled === undefined) {
      store.audit("schedule.skipped", { id: schedule.id, reason: "no Herder" });
      return;
    }
    store.audit("schedule.run", { id: schedule.id, about: schedule.about, due: schedule.nextAt });
    herder.scheduled(schedule);
  }

  /** Looks again in a minute while something is waiting to run. */
  private arm(): void {
    if (!this.running || this.timer !== undefined) return;
    if (!this.ctx.store.schedules().some((s) => !s.paused)) return;
    this.timer = this.clock.after(SCHEDULE_TICK_MS, () => {
      this.timer = undefined;
      this.tick();
    });
  }
}
