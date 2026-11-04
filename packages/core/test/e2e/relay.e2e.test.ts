// E2E scenarios for plan 008: tasks started from chat with fixed commands, relays, interrupts.
// A real mock agent speaks ACP; the fake channel plays the owner.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AgentProfile, RelayView, ReportView, TextView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../src/clock.ts";
import { HELP_TEXT } from "../../src/commands.ts";
import { Herd, RELAY_KEY } from "../../src/herd.ts";
import { Store } from "../../src/store.ts";

const BIN = fileURLToPath(new URL("../../../mock-agent/bin/mock-agent.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "agentherd-relay-"));
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

async function setup(script: string, clock?: FakeClock) {
  const channel = new FakeChannel("owner");
  const store = Store.open(":memory:");
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    profiles: [profile(script)],
    store,
    boardDebounceMs: 10,
    ...(clock === undefined ? {} : { clock }),
  });
  herds.push(herd);
  await herd.start();
  return { channel, store, herd };
}

const texts = (c: FakeChannel) => c.ofKind("text").map((m) => (m.view as TextView).text);
const reports = (c: FakeChannel) => c.ofKind("report").map((m) => m.view as ReportView);
const relays = (c: FakeChannel) => c.ofKind("relay").map((m) => m.view as RelayView);

/** Waits until the predicate holds, polling the event loop. */
async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const THREE_TURNS = `
turns:
  - - message: "first done"
    - end_turn: end_turn
  - - message: "second done"
    - end_turn: end_turn
  - - message: "third done"
    - end_turn: end_turn
`;

describe("E2E-RUN-COMMAND", () => {
  it("/run starts a task in the directory and sends its report", async () => {
    const { channel, herd } = await setup(THREE_TURNS);
    await channel.say(`/run mock ${dir} Fix the build\nsecond line`);
    await until(() => reports(channel).length === 1);
    expect(reports(channel)[0]?.body).toBe("first done");
    expect(reports(channel)[0]?.title).toMatch(/^Done: Fix the build/);
    expect(herd.openTasks()).toHaveLength(1);
  });

  it("an unknown agent or directory gets a plain answer and starts nothing", async () => {
    const { channel, herd } = await setup(THREE_TURNS);
    await channel.say(`/run nope ${dir} task`);
    await channel.say("/run mock /does/not/exist task");
    await channel.say("/run mock");
    expect(texts(channel)).toEqual([
      'Unknown agent "nope". Known: mock.',
      "Not a directory: /does/not/exist",
      "Usage: /run <agent> <dir> <task>",
    ]);
    expect(herd.tasks()).toHaveLength(0);
  });
});

describe("E2E-RELAY", () => {
  it("plain text goes to the task verbatim; the reply comes back labeled; /end ends it", async () => {
    const { channel, herd, store } = await setup(THREE_TURNS);
    await channel.say(`/run mock ${dir} Write notes`);
    await until(() => reports(channel).length === 1);
    await channel.say("/relay notes");
    expect(relays(channel)[0]).toMatchObject({ active: true, taskLabel: "Write notes" });
    expect(herd.relay()?.taskId).toBe(herd.tasks()[0]?.id);

    await channel.say("  Add a fourth line\n  please ");
    await until(() => texts(channel).includes("second done"));
    const reply = channel.ofKind("text").find((m) => (m.view as TextView).text === "second done");
    expect((reply?.view as TextView | undefined)?.taskLabel).toBe("Write notes");
    expect(reports(channel)).toHaveLength(1); // no report or summary turn during a relay

    await channel.say("/end");
    expect(relays(channel)[1]).toMatchObject({ active: false });
    expect(store.getState(RELAY_KEY)).toBeUndefined();

    // After the relay, plain text gets the help text, not the agent.
    await channel.say("hello");
    expect(texts(channel).at(-1)).toContain(HELP_TEXT);
  });

  it("the agent receives the owner's text exactly", async () => {
    const { channel, herd } = await setup(THREE_TURNS);
    const seen: string[] = [];
    await channel.say(`/run mock ${dir} task`);
    await until(() => reports(channel).length === 1);
    const id = herd.tasks()[0]?.id ?? "";
    const original = herd.promptTask.bind(herd);
    herd.promptTask = (taskId, text) => {
      seen.push(text);
      return original(taskId, text);
    };
    await channel.say(`/relay ${id.slice(0, 8)}`);
    await channel.say("  keep\n  spacing ");
    await until(() => texts(channel).includes("second done"));
    expect(seen).toEqual(["  keep\n  spacing "]);
  });

  it("the relay ends after relayIdleMinutes with no owner message", async () => {
    const clock = new FakeClock("2026-11-04T06:00:00.000Z");
    const { channel } = await setup(THREE_TURNS, clock);
    await channel.say(`/run mock ${dir} task`);
    await until(() => reports(channel).length === 1);
    await channel.say("/relay task");
    await clock.advance(29 * 60_000);
    expect(relays(channel)).toHaveLength(1);
    await clock.advance(60_000);
    expect(relays(channel)[1]).toMatchObject({ active: false });
  });

  it("the report button starts a relay; the End relay button ends it", async () => {
    const { channel, herd } = await setup(THREE_TURNS);
    await channel.say(`/run mock ${dir} task`);
    await until(() => reports(channel).length === 1);
    const taskId = reports(channel)[0]?.taskId ?? "";
    await channel.tap(taskId, "relay");
    expect(herd.relay()?.taskId).toBe(taskId);
    await channel.tap(taskId, "relay", "someone-else");
    await channel.tap(taskId, "end-relay");
    expect(herd.relay()).toBeUndefined();
    expect(relays(channel).map((r) => r.active)).toEqual([true, false]);
  });

  it("a relay ends when its task ends", async () => {
    const { channel, herd } = await setup(THREE_TURNS);
    await channel.say(`/run mock ${dir} task`);
    await until(() => reports(channel).length === 1);
    const id = herd.tasks()[0]?.id ?? "";
    await channel.say("/relay task");
    await herd.endTask(id, "test");
    expect(herd.relay()).toBeUndefined();
    expect(relays(channel).at(-1)).toMatchObject({ active: false });
  });
});

describe("E2E-INTERRUPT", () => {
  it("cancels the running turn, then sends the text", async () => {
    const { channel } = await setup(`
turns:
  - - message: "first done"
    - end_turn: end_turn
  - - message: "slow start"
    - sleep: 5000
    - message: "never"
    - end_turn: end_turn
  - - message: "after interrupt"
    - end_turn: end_turn
`);
    await channel.say(`/run mock ${dir} task`);
    await until(() => reports(channel).length === 1);
    await channel.say("/relay task");
    await channel.say("go slow");
    await channel.say("/interrupt stop and do this");
    await until(() => texts(channel).includes("after interrupt"));
    expect(texts(channel).join("\n")).not.toContain("never");
  });
});

describe("E2E-HELP", () => {
  it("/help and plain text without a Herder model list the commands", async () => {
    const { channel } = await setup(THREE_TURNS);
    await channel.say("/help");
    await channel.say("what is running?");
    await channel.say("/end");
    expect(texts(channel)[0]).toBe(HELP_TEXT);
    expect(texts(channel)[1]).toContain(HELP_TEXT);
    expect(texts(channel)[2]).toBe("No relay is active.");
  });
});
