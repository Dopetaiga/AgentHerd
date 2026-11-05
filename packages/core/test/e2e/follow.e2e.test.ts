// E2E scenarios for following tasks (docs/spec/07-delivery.md, plan 007): stages on the pinned
// board, completion reports by size, and the watchdog. A real mock agent speaks ACP.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AgentProfile, BoardView, ReportView, TextView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { Herd } from "../../src/herd.ts";
import { Store } from "../../src/store.ts";

const BIN = fileURLToPath(new URL("../../../mock-agent/bin/mock-agent.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "agentherd-follow-"));
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

async function setup(script: string) {
  const channel = new FakeChannel("owner");
  const store = Store.open(":memory:");
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    locale: "en",
    profiles: [profile(script)],
    store,
    boardDebounceMs: 10,
  });
  herds.push(herd);
  await herd.start();
  return { channel, store, herd };
}

const reports = (c: FakeChannel) => c.ofKind("report").map((m) => m.view as ReportView);
const LONG = "x".repeat(900);

describe("E2E-REPORT-SHORT", () => {
  it("a short final reply is the report body, verbatim", async () => {
    const { channel, herd } = await setup(`
turns:
  - - message: "Fixed the flaky test. "
    - message: "All 42 tests pass."
    - end_turn: end_turn
`);
    mkdirSync(join(dir, "shop"), { recursive: true });
    await herd.run("mock", join(dir, "shop"), "Fix the flaky checkout test\nmore details");
    const [report] = reports(channel);
    expect(report?.body).toBe("Fixed the flaky test. All 42 tests pass.");
    expect(report?.summarized).toBe(false);
    expect(report?.title).toMatch(/^Done: Fix the flaky checkout test · shop · Mock · \d+s$/);
    expect(herd.tasks()[0]?.stage).toBe("done");
  });
});

describe("E2E-STOP-MID-TURN", () => {
  it("stopping AgentHerd mid-turn reports that it stopped, not that the agent exited", async () => {
    const { channel, herd } = await setup(`
turns:
  - - message: "Looking. "
    - sleep: 5000
    - end_turn: end_turn
`);
    mkdirSync(join(dir, "stop"), { recursive: true });
    const { turn } = await herd.startTask("mock", join(dir, "stop"), "Look around");
    turn.catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    await herd.stop();
    const [report] = reports(channel);
    expect(report?.body).toContain("AgentHerd stopped");
    expect(report?.body).not.toContain("exited");
  });
});

describe("E2E-REPORT-LONG", () => {
  it("a long reply is summarized by the agent itself; the full reply is attached", async () => {
    const { channel, herd } = await setup(`
turns:
  - - message: "${LONG}"
    - end_turn: end_turn
  - - message: "Short summary."
    - end_turn: end_turn
`);
    await herd.run("mock", dir, "task");
    const [report] = reports(channel);
    expect(report?.body).toBe("Short summary.");
    expect(report?.summarized).toBe(true);
    expect(report?.fullReply).toBe(LONG);
  });

  it("falls back to the original reply when the summary turn calls tools", async () => {
    const { channel, herd } = await setup(`
turns:
  - - message: "${LONG}"
    - end_turn: end_turn
  - - tool_call: { id: t9, title: "Read file", kind: read }
    - message: "Short summary."
    - end_turn: end_turn
`);
    await herd.run("mock", dir, "task");
    const [report] = reports(channel);
    expect(report?.body).toBe(LONG);
    expect(report?.summarized).toBe(false);
  });
});

describe("E2E-BOARD", () => {
  it("one pinned board is updated in place as the stage changes", async () => {
    const { channel, herd } = await setup(`
turns:
  - - message: "working"
    - sleep: 100
    - message: "done"
    - end_turn: end_turn
`);
    await herd.run("mock", dir, "Board task");
    const boards = channel.ofKind("board");
    expect(boards).toHaveLength(1);
    const board = boards[0];
    if (board === undefined) throw new Error("no board");
    expect(board.pinned).toBe(true);
    const stages = board.history.map((v) => (v as BoardView).rows[0]?.stage);
    expect(stages).toContain("working");
    expect((board.view as BoardView).rows[0]).toMatchObject({ task: "Board task", stage: "done" });
  });
});

describe("E2E-STATUS", () => {
  it("the owner's status message sends the board again and pins it", async () => {
    const { channel, herd } = await setup(`
turns:
  - - message: "ok"
    - end_turn: end_turn
`);
    await herd.run("mock", dir, "first");
    await channel.say("status", "owner");
    await channel.say("status", "someone-else");
    const boards = channel.ofKind("board");
    expect(boards).toHaveLength(2);
    expect(boards[1]?.pinned).toBe(true);
  });
});

describe("E2E-WATCHDOG", () => {
  it("the same tool call three times in one turn tells the owner", async () => {
    const call = `{ id: t1, title: "Run tests", kind: execute, command: "npm test" }`;
    const { channel, herd } = await setup(`
turns:
  - - tool_call: ${call.replace("t1", "a")}
    - tool_call: ${call.replace("t1", "b")}
    - tool_call: ${call.replace("t1", "c")}
    - end_turn: end_turn
`);
    await herd.run("mock", dir, "loop");
    const texts = channel.ofKind("text").map((m) => m.view as TextView);
    expect(texts).toHaveLength(1);
    expect(texts[0]?.text).toBe("Watchdog: the same tool call ran 3 times: npm test");
    expect(texts[0]?.taskLabel).toBe("loop");
  });

  it("an agent that crashes ends the task as failed with a report", async () => {
    const { channel, herd } = await setup(`
turns:
  - - message: "starting"
    - crash: 7
`);
    await expect(herd.run("mock", dir, "crashy")).rejects.toThrow(/exited/);
    const [report] = reports(channel);
    expect(report?.title).toMatch(/^Failed: crashy/);
    expect(herd.tasks()[0]?.stage).toBe("failed");
    expect(channel.ofKind("text").map((m) => (m.view as TextView).text)).toContain(
      "Watchdog: the agent exited (code 7)",
    );
  });
});
