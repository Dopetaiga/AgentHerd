// E2E scenarios for M1 (docs/spec/07-delivery.md): a real mock agent process speaks ACP,
// the core decides, and a fake channel plays the owner.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel, type SentMessage } from "@agentherd/channel-fake";
import type { AgentProfile, ItemView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../src/clock.ts";
import { Herd } from "../../src/herd.ts";
import { Store } from "../../src/store.ts";

const BIN = fileURLToPath(new URL("../../../mock-agent/bin/mock-agent.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "agentherd-e2e-"));
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

async function setup(script: string, opts: { remindMinutes?: number; clock?: FakeClock } = {}) {
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
    ...(opts.clock === undefined ? {} : { clock: opts.clock }),
    ...(opts.remindMinutes === undefined ? {} : { remindMinutes: opts.remindMinutes }),
  });
  herds.push(herd);
  await herd.start();
  return { channel, store, herd };
}

const isOpenItem = (m: SentMessage) =>
  m.view.kind === "item" && (m.view as ItemView).final === undefined;

// Only a mass delete reaches the owner (ADR 0029); a plain command is approved by AgentHerd.
const ONE_PERMISSION = (expect: string, command = "rm -rf ./*") => `
turns:
  - - tool_call: { id: t1, title: "Run ${command}", kind: execute, command: "${command}", status: pending }
    - request_permission:
        toolCall: { id: t1, title: "Run ${command}", kind: execute, command: "${command}" }
        expect: ${expect}
    - message: "done"
    - end_turn: end_turn
`;

describe("E2E-APPROVE", () => {
  it("the owner's Allow reaches the agent and the card shows the result", async () => {
    const { channel, store, herd } = await setup(ONE_PERMISSION("allow"));
    const run = herd.run("mock", dir, "go");
    const card = await channel.waitFor(isOpenItem);
    const view = card.view as ItemView;
    expect(view.body).toContain("rm -rf ./*");
    expect(view.reason).toBe("deletes a lot at once; needs your confirmation");
    await channel.tap(view.itemId, "allow");
    const result = await run;
    expect(result.stopReason).toBe("end_turn");
    expect((card.view as ItemView).final).toBe("Allowed by you");
    expect((card.view as ItemView).options).toEqual([]);
    const decisions = store.decisionsFor(view.itemId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ action: "allow", source: "human", ownerId: "owner" });
    expect(store.getItem(view.itemId)?.state).toBe("decided");
  });

  it("Deny reaches the agent", async () => {
    const { channel, herd } = await setup(ONE_PERMISSION("deny"));
    const run = herd.run("mock", dir, "go");
    const card = await channel.waitFor(isOpenItem);
    await channel.tap((card.view as ItemView).itemId, "deny");
    await run;
    expect((card.view as ItemView).final).toBe("Denied by you");
  });

  it("a command that is not a mass delete is approved without a card", async () => {
    const { channel, store, herd } = await setup(ONE_PERMISSION("allow", "pnpm test"));
    await herd.run("mock", dir, "go");
    expect(channel.ofKind("item")).toHaveLength(0);
    expect(store.auditRows("item.decided")).toHaveLength(1);
  });

  it("an owner's deny rule answers without a card", async () => {
    const { channel, store, herd } = await setup(ONE_PERMISSION("deny", "pnpm test"));
    herd.addRule({
      id: "r1",
      action: "deny",
      match: { command: "pnpm test" },
      createdAt: "2026-11-04T00:00:00Z",
      createdBy: "owner",
    });
    await herd.run("mock", dir, "go");
    expect(channel.ofKind("item")).toHaveLength(0);
    expect(store.auditRows("item.decided")).toHaveLength(1);
  });
});

describe("E2E-OWNER-ONLY", () => {
  it("a tap from someone else changes nothing", async () => {
    const { channel, store, herd } = await setup(ONE_PERMISSION("allow"));
    const run = herd.run("mock", dir, "go");
    const card = await channel.waitFor(isOpenItem);
    const itemId = (card.view as ItemView).itemId;
    await channel.tap(itemId, "allow", "intruder");
    expect((card.view as ItemView).final).toBeUndefined();
    expect(store.decisionsFor(itemId)).toHaveLength(0);
    expect(store.auditRows("inbound.dropped")).toHaveLength(1);
    await channel.tap(itemId, "allow");
    await run;
    expect(store.decisionsFor(itemId)).toHaveLength(1);
  });
});

describe("E2E-DUPLICATE-ACTION", () => {
  it("a second tap is dropped", async () => {
    const { channel, store, herd } = await setup(ONE_PERMISSION("allow"));
    const run = herd.run("mock", dir, "go");
    const card = await channel.waitFor(isOpenItem);
    const itemId = (card.view as ItemView).itemId;
    await Promise.all([channel.tap(itemId, "allow"), channel.tap(itemId, "deny")]);
    await run;
    expect(store.decisionsFor(itemId)).toHaveLength(1);
    expect((card.view as ItemView).final).toBe("Allowed by you");
    await channel.tap(itemId, "deny");
    expect(store.decisionsFor(itemId)).toHaveLength(1);
  });
});

describe("E2E-REMIND", () => {
  it("an open item gets reminders and is never decided by time", async () => {
    const clock = new FakeClock();
    const { channel, store, herd } = await setup(ONE_PERMISSION("allow"), {
      clock,
      remindMinutes: 30,
    });
    const run = herd.run("mock", dir, "go");
    const card = await channel.waitFor(isOpenItem);
    const itemId = (card.view as ItemView).itemId;
    await clock.advance(29 * 60_000);
    expect(channel.ofKind("text")).toHaveLength(0);
    await clock.advance(2 * 60_000);
    await clock.advance(30 * 60_000);
    await new Promise((r) => setImmediate(r));
    const reminders = channel.ofKind("text");
    expect(reminders).toHaveLength(2);
    expect(reminders[0]?.view.text).toBe("Still waiting for you: Run rm -rf ./*");
    expect(store.decisionsFor(itemId)).toHaveLength(0);
    expect(store.getItem(itemId)?.state).toBe("open");
    await channel.tap(itemId, "allow");
    await run;
    await clock.advance(60 * 60_000);
    expect(channel.ofKind("text")).toHaveLength(2);
  });
});
