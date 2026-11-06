// Restarts (docs/spec/03-agents.md "Restarts"): what a stop or a crash cut off is ended on the
// next start and the owner hears about it. Asking to continue is ADR 0040 (persist.e2e).

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AgentProfile, RelayView, Stage, TextView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { Herd, INTERRUPTED_STATE, RELAY_KEY } from "../../src/herd.ts";
import { Store } from "../../src/store.ts";
import { CORE_TEXTS } from "../../src/texts.ts";

const T = CORE_TEXTS["zh-CN"];
const BIN = fileURLToPath(new URL("../../../mock-agent/bin/mock-agent.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "agentherd-restart-"));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

function profile(script: string): AgentProfile {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(file, script);
  return {
    id: "mock",
    name: "Mock",
    command: [process.execPath, BIN, "--script", file],
    env: {},
    exporter: null,
  };
}

function herdOn(
  store: Store,
  {
    script = "turns: []\n",
    closeStaleTasks,
    herder = true,
  }: Partial<{
    script: string;
    closeStaleTasks: boolean;
    herder: boolean;
  }> = {},
) {
  const channel = new FakeChannel("owner");
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    profiles: [profile(script)],
    store,
    boardDebounceMs: 10,
    ...(herder
      ? {
          herder: () => ({
            ownerMessage: () => {},
            ownerAnswer: () => {},
            event: () => {},
            stop: async () => {},
          }),
        }
      : {}),
    ...(closeStaleTasks === undefined ? {} : { closeStaleTasks }),
  });
  herds.push(herd);
  return { channel, herd };
}

const texts = (c: FakeChannel) => c.ofKind("text").map((m) => (m.view as TextView).text);

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const AT = "2026-11-06T01:00:00.000Z";

/** What a crash leaves behind: sessions and tasks still running, a relay. */
function crashedStore(): Store {
  const store = Store.open(":memory:");
  const running = (id: string, title: string, stage: Stage, at: string) => {
    store.upsertSession({
      id,
      profileId: "mock",
      cwd: dir,
      state: stage === "done" ? "idle" : "working",
      createdAt: at,
      updatedAt: at,
    });
    store.saveTask({
      task: {
        id,
        title,
        project: "proj",
        agent: "Mock",
        stage,
        lastReport: "",
        startedAt: at,
        updatedAt: at,
        automaticDecisions: [],
      },
      cwd: dir,
      profileId: "mock",
      failed: false,
    });
  };
  running("busy-1", "Fix the build", "working", AT);
  running("busy-2", "Write docs", "needs-owner", "2026-11-06T01:01:00.000Z");
  running("idle-1", "Write notes", "done", "2026-11-06T01:02:00.000Z");
  store.setState(RELAY_KEY, { taskId: "busy-1", startedAt: AT });
  return store;
}

const unended = (store: Store) =>
  store
    .recentSessions(50)
    .filter((s) => s.state !== "ended")
    .map((s) => s.id)
    .sort();

describe("E2E-RESTART", () => {
  it("ends the sessions and the relay an earlier run left open", async () => {
    const store = crashedStore();
    const { channel, herd } = herdOn(store);
    await herd.start();

    expect(unended(store)).toEqual([]);
    expect(store.getState(RELAY_KEY)).toBeUndefined();
    expect(channel.ofKind("relay").map((m) => m.view as RelayView)).toEqual([
      { kind: "relay", taskId: "busy-1", taskLabel: "Fix the build", active: false },
    ]);
    expect(herd.openTasks()).toEqual([]);
    expect(store.task("busy-1")?.endedAt).toBeDefined();
    // With a Herder the owner is asked whether to continue them (ADR 0040), not told twice.
    expect(channel.ofKind("ask")).toHaveLength(1);
    expect(texts(channel)).toEqual([]);
  });

  it("without a Herder, tells the owner which tasks were cut off", async () => {
    const { channel, herd } = herdOn(crashedStore(), { herder: false });
    await herd.start();
    expect(texts(channel)).toEqual([T.interruptedTasks(["Fix the build", "Write docs"])]);
    expect(channel.ofKind("ask")).toEqual([]);
  });

  it("says nothing when no task was left running", async () => {
    const { channel, herd } = herdOn(Store.open(":memory:"));
    await herd.start();
    expect(texts(channel)).toEqual([]);
    expect(channel.ofKind("ask")).toEqual([]);
  });

  it("leaves running tasks alone when asked to (a one-off run beside a host)", async () => {
    const store = crashedStore();
    store.setState(INTERRUPTED_STATE, ["busy-1"]);
    const { channel, herd } = herdOn(store, { closeStaleTasks: false });
    await herd.start();
    expect(texts(channel)).toEqual([]);
    expect(channel.ofKind("ask")).toEqual([]);
    expect(store.task("busy-1")?.endedAt).toBeUndefined();
    expect(unended(store)).toEqual(["busy-1", "busy-2", "idle-1"]);
    expect(store.getState(INTERRUPTED_STATE)).toEqual(["busy-1"]);
  });

  it("stopping with a task still working tells the owner first", async () => {
    const store = Store.open(":memory:");
    const first = herdOn(store, { script: "turns:\n  - - sleep: 60000\n" });
    await first.herd.start();
    await first.channel.say(`/run mock ${dir} Long job`);
    await until(() => first.herd.openTasks()[0]?.stage === "working");

    await first.herd.stop();
    expect(texts(first.channel)).toContain(T.stoppingTasks(["Long job"]));
    expect(unended(store)).toEqual([]);
  });
});
