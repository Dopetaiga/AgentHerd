// E2E for schedules (ADR 0055): the Herder makes one for the owner and it holds at once; at the
// time its words come back to the Herder; a time missed while AgentHerd was off runs once, not
// once per missed time; a paused one waits; a "once" one goes away after it ran.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel } from "@agentherd/channel-fake";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../src/clock.ts";
import { Herd } from "../../src/herd.ts";
import type { HerderHost } from "../../src/herder-port.ts";
import { checkWhen, describeWhen, nextRun, type Schedule } from "../../src/schedules.ts";
import { Store } from "../../src/store.ts";

const dir = mkdtempSync(join(tmpdir(), "agentherd-schedules-"));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

/** A local time, so the tests hold in any time zone. */
const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);

async function setup(store = Store.open(":memory:"), start = local(4, 8)) {
  const channel = new FakeChannel("owner");
  const clock = new FakeClock(start.toISOString());
  let host: HerderHost | undefined;
  const runs: Schedule[] = [];
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    locale: "en",
    profiles: [],
    store,
    clock,
    boardDebounceMs: 10,
    herder: (h) => {
      host = h;
      return {
        ownerMessage() {},
        ownerAnswer() {},
        event() {},
        scheduled: (s) => runs.push(s),
        stop: async () => {},
      };
    },
  });
  herds.push(herd);
  await herd.start();
  if (host === undefined) throw new Error("no herder host");
  return { herd, clock, host, runs, store };
}

describe("schedule times", () => {
  it("finds the next daily, weekday, every and once time", () => {
    const daily = checkWhen({ kind: "daily", at: "9:00" });
    expect(daily).toEqual({ kind: "daily", at: "09:00" });
    expect(nextRun(daily, local(4, 8))).toEqual(local(4, 9));
    expect(nextRun(daily, local(4, 9))).toEqual(local(5, 9));
    // 2026-11-07 is a Saturday: weekdays only → Monday the 9th.
    const weekdays = checkWhen({ kind: "daily", at: "09:00", days: [5, 4, 3, 2, 1] });
    expect(weekdays).toEqual({ kind: "daily", at: "09:00", days: [1, 2, 3, 4, 5] });
    expect(nextRun(weekdays, local(7, 10))).toEqual(local(9, 9));
    expect(checkWhen({ kind: "daily", at: "09:00", days: [1, 2, 3, 4, 5, 6, 7] })).toEqual(daily);
    expect(nextRun({ kind: "every", hours: 3 }, local(4, 8))).toEqual(local(4, 11));
    const once = checkWhen({ kind: "once", at: "2026-11-05T15:30" });
    expect(once).toEqual({ kind: "once", at: "2026-11-05 15:30" });
    expect(nextRun(once, local(4, 8))).toEqual(local(5, 15, 30));
    expect(nextRun(once, local(6, 8))).toBeUndefined();
    expect(describeWhen(weekdays)).toBe("Mon, Tue, Wed, Thu, Fri at 09:00");
  });

  it("refuses times it cannot run", () => {
    expect(() => checkWhen({ kind: "daily", at: "25:00" })).toThrow(/HH:MM/);
    expect(() => checkWhen({ kind: "daily", at: "09:00", days: [0] })).toThrow(/Monday/);
    expect(() => checkWhen({ kind: "every", hours: 0.5 })).toThrow(/hours must be/);
    expect(() => checkWhen({ kind: "once", at: "2026-02-30 09:00" })).toThrow(/YYYY-MM-DD/);
  });
});

describe("E2E-SCHEDULES (ADR 0055)", () => {
  it("holds at once and brings the owner's words back at the time", async () => {
    const { clock, host, runs, store } = await setup();
    const made = host.addSchedule?.({
      about: "早上看新 issue",
      prompt: "看看 ~/learnspace/PI-Desktop 有没有新 issue，没有就不用说",
      when: { kind: "daily", at: "09:00" },
    });
    expect(made?.nextAt).toBe(local(4, 9).toISOString());
    expect(host.schedules?.()).toHaveLength(1);

    await clock.advance(59 * 60_000);
    expect(runs).toEqual([]);
    await clock.advance(2 * 60_000);
    expect(runs.map((r) => r.prompt)).toEqual([made?.prompt]);
    expect(host.schedules?.()[0]?.nextAt).toBe(local(5, 9).toISOString());

    await clock.advance(24 * 3_600_000);
    expect(runs).toHaveLength(2);
    expect(store.auditRows("schedule.run")).toHaveLength(2);
  });

  it("runs a time missed while AgentHerd was off once, not once per missed day", async () => {
    const store = Store.open(join(dir, "missed.db"));
    const first = await setup(store);
    first.host.addSchedule?.({
      about: "早上",
      prompt: "看 issue",
      when: { kind: "daily", at: "09:00" },
    });
    await first.herd.stop();
    herds = herds.filter((h) => h !== first.herd);

    // Three days later at noon.
    const second = await setup(store, local(7, 12));
    expect(second.runs).toHaveLength(1);
    expect(second.host.schedules?.()[0]?.nextAt).toBe(local(8, 9).toISOString());
    await second.herd.stop();
    herds = herds.filter((h) => h !== second.herd);
    store.close();
  });

  it("a paused one waits; a once one goes away after it ran", async () => {
    const { clock, host, runs } = await setup();
    const daily = host.addSchedule?.({
      about: "早上",
      prompt: "看 issue",
      when: { kind: "daily", at: "09:00" },
    });
    host.addSchedule?.({
      about: "交周报",
      prompt: "提醒我交周报",
      when: { kind: "once", at: "2026-11-04 10:00" },
    });
    if (daily === undefined) throw new Error("not made");
    const paused = host.changeSchedule?.(daily.id, { paused: true });
    expect(paused?.nextAt).toBeUndefined();

    await clock.advance(3 * 3_600_000);
    expect(runs.map((r) => r.about)).toEqual(["交周报"]);
    expect(host.schedules?.().map((s) => s.about)).toEqual(["早上"]);

    host.changeSchedule?.(daily.id, { paused: false });
    expect(host.schedules?.()[0]?.nextAt).toBe(local(5, 9).toISOString());
    expect(host.removeSchedule?.(daily.id)).toBe(true);
    expect(host.schedules?.()).toEqual([]);
  });

  it("refuses a time already past and more than the limit", async () => {
    const { host } = await setup();
    expect(() =>
      host.addSchedule?.({
        about: "x",
        prompt: "y",
        when: { kind: "once", at: "2026-11-03 09:00" },
      }),
    ).toThrow(/already past/);
    for (let i = 0; i < 20; i++) {
      host.addSchedule?.({ about: `s${i}`, prompt: "p", when: { kind: "every", hours: 5 } });
    }
    expect(() =>
      host.addSchedule?.({ about: "x", prompt: "y", when: { kind: "every", hours: 5 } }),
    ).toThrow(/at most 20/);
  });
});
