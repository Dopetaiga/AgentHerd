import { describe, expect, it } from "vitest";
import { FakeClock } from "../src/clock.ts";
import { type Alarm, Watchdog } from "../src/watchdog.ts";

function make(over: { watchdogSeconds?: number; maxQuietMinutes?: number } = {}) {
  const clock = new FakeClock();
  const alarms: Alarm[] = [];
  const watchdog = new Watchdog({
    clock,
    onAlarm: (alarm) => alarms.push(alarm),
    ...(over.watchdogSeconds === undefined ? {} : { watchdogSeconds: over.watchdogSeconds }),
    ...(over.maxQuietMinutes === undefined ? {} : { maxQuietMinutes: over.maxQuietMinutes }),
  });
  return { clock, alarms, watchdog };
}

describe("Watchdog", () => {
  it("alarms once on three identical tool calls in a turn", () => {
    const { alarms, watchdog } = make();
    watchdog.track("s");
    watchdog.turnStarted("s");
    watchdog.toolCall("s", "run:pnpm test", "pnpm test");
    watchdog.toolCall("s", "run:pnpm test", "pnpm test");
    watchdog.toolCall("s", "run:pnpm test", "pnpm test");
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ sessionId: "s", reason: "repeated-tool-call" });
    expect(alarms[0]?.detail).toContain("3 times");
    expect(alarms[0]?.detail).toContain("pnpm test");

    watchdog.toolCall("s", "run:pnpm test", "pnpm test");
    expect(alarms).toHaveLength(1);
  });

  it("turnStarted resets counts and raised alarms", () => {
    const { alarms, watchdog } = make();
    watchdog.track("s");
    watchdog.turnStarted("s");
    watchdog.toolCall("s", "run:pnpm test", "pnpm test");
    watchdog.toolCall("s", "run:pnpm test", "pnpm test");
    watchdog.toolCall("s", "run:pnpm test", "pnpm test");
    expect(alarms).toHaveLength(1);

    watchdog.turnStarted("s");
    watchdog.toolCall("s", "run:pnpm test", "pnpm test");
    watchdog.toolCall("s", "run:pnpm test", "pnpm test");
    watchdog.toolCall("s", "run:pnpm test", "pnpm test");
    expect(alarms).toHaveLength(2);
  });

  it("does not alarm on different tool-call keys", () => {
    const { alarms, watchdog } = make();
    watchdog.track("s");
    watchdog.turnStarted("s");
    watchdog.toolCall("s", "run:a", "a");
    watchdog.toolCall("s", "run:b", "b");
    watchdog.toolCall("s", "run:c", "c");
    expect(alarms).toHaveLength(0);
  });

  it("raises a quiet alarm after maxQuietMinutes while working", async () => {
    const { alarms, clock, watchdog } = make({ watchdogSeconds: 60, maxQuietMinutes: 30 });
    watchdog.track("s");
    watchdog.turnStarted("s");

    await clock.advance(29 * 60_000);
    expect(alarms).toHaveLength(0);

    await clock.advance(60_000);
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ sessionId: "s", reason: "quiet" });

    await clock.advance(60_000);
    expect(alarms).toHaveLength(1);
  });

  it("does not raise a quiet alarm after turnEnded", async () => {
    const { alarms, clock, watchdog } = make({ watchdogSeconds: 60, maxQuietMinutes: 30 });
    watchdog.track("s");
    watchdog.turnStarted("s");
    watchdog.turnEnded("s");

    await clock.advance(31 * 60_000);
    expect(alarms).toHaveLength(0);
  });

  it("does not raise a quiet alarm while waiting on the owner", async () => {
    const { alarms, clock, watchdog } = make({ watchdogSeconds: 60, maxQuietMinutes: 30 });
    watchdog.track("s");
    watchdog.turnStarted("s");
    watchdog.waiting("s", true);

    await clock.advance(31 * 60_000);
    expect(alarms).toHaveLength(0);
  });

  it("raises agent-exited", () => {
    const { alarms, watchdog } = make();
    watchdog.track("s");
    watchdog.exited("s", "crashed");
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ sessionId: "s", reason: "agent-exited", detail: "crashed" });
  });

  it("untrack stops events and cancels the timer", () => {
    const { alarms, clock, watchdog } = make();
    watchdog.track("s");
    expect(clock.pending()).toBe(1);
    watchdog.untrack("s");
    expect(clock.pending()).toBe(0);

    watchdog.toolCall("s", "run:a", "a");
    watchdog.exited("s", "x");
    expect(alarms).toHaveLength(0);
  });

  it("stop cancels the timer", () => {
    const { clock, watchdog } = make();
    watchdog.track("s");
    expect(clock.pending()).toBe(1);
    watchdog.stop();
    expect(clock.pending()).toBe(0);
  });
});
