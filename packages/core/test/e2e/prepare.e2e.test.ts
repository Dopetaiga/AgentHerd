// E2E for ADR 0105: a profile with a required permission mode (ZCode) prepares every session
// before work — `session/set_mode`, confirmed by the running session itself — before the first
// prompt, before a replay, and again on the replacement session. The owner's account choice
// survives recovery: ZCode is never an automatic substitute, and a ZCode task never falls back.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AgentProfile, ReportView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { Herd } from "../../src/herd.ts";
import { Store } from "../../src/store.ts";

const MOCK_INDEX = fileURLToPath(new URL("../../../mock-agent/src/index.ts", import.meta.url));
const MOCK_SDK = fileURLToPath(
  new URL(
    "../../../mock-agent/node_modules/@agentclientprotocol/sdk/dist/v1/stable/acp.js",
    import.meta.url,
  ),
);
let herds: { herd: Herd; store: Store }[] = [];

afterEach(async () => {
  for (const o of herds) {
    await o.herd.stop();
    o.store.close();
  }
  herds = [];
});

/**
 * A mock agent whose diagnostics land in `log`: the wrapper mirrors mock-agent's CLI so the
 * tests can read the order of `mode`, `load` and `prompt` lines.
 */
function zcodeProfile(
  home: string,
  script: string,
  log: string,
  opts: { id?: string; plain?: boolean } = {},
): AgentProfile {
  const id = opts.id ?? "zcode";
  const scriptFile = join(home, `${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(scriptFile, script);
  const wrap = join(home, `${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(
    wrap,
    `import { appendFileSync, readFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from ${JSON.stringify(pathToFileURL(MOCK_SDK).href)};
import { createMockAgent, parseScript } from ${JSON.stringify(pathToFileURL(MOCK_INDEX).href)};
const script = parseScript(readFileSync(${JSON.stringify(scriptFile)}, "utf8"));
const log = (line) => {
  appendFileSync(${JSON.stringify(log)}, line + "\\n");
  process.stderr.write("[mock-agent] " + line + "\\n");
};
const stream = ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
);
const connection = createMockAgent(script, { log }).connect(stream);
await connection.closed;
`,
  );
  const profile: AgentProfile = {
    id,
    name: id === "zcode" ? "ZCode" : "Mock",
    command: [process.execPath, wrap],
    env: {},
    exporter: null,
  };
  if (opts.plain !== true) {
    profile.ownModels = true;
    profile.mode = "build";
  }
  return profile;
}

function logLines(log: string): string[] {
  try {
    return readFileSync(log, "utf8")
      .split("\n")
      .filter((l) => l !== "");
  } catch {
    return [];
  }
}

/** A Herd on `<home>/herd.db`, as after an AgentHerd start; a second boot sees the first's tasks. */
async function boot(
  home: string,
  profiles: AgentProfile[],
): Promise<{ herd: Herd; store: Store; channel: FakeChannel }> {
  const store = Store.open(join(home, "herd.db"));
  const channel = new FakeChannel("owner");
  const herd = new Herd({
    home,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    locale: "en",
    profiles,
    store,
    boardDebounceMs: 10,
  });
  const o = { herd, store, channel };
  herds.push(o);
  await herd.start();
  return o;
}

async function shutDown(o: { herd: Herd; store: Store }): Promise<void> {
  await o.herd.stop();
  o.store.close();
  herds = herds.filter((x) => x !== o);
}

const ONE_TURN = `
turns:
  - - message: "done"
    - end_turn: end_turn
`;

describe("session preparation before work (ADR 0105)", () => {
  it("confirms the profile's mode before the first prompt", async () => {
    const home = mkdtempSync(join(tmpdir(), "agentherd-prepare-"));
    const log = join(home, "confirm.log");
    const { herd, channel } = await boot(home, [
      zcodeProfile(home, `set_mode: confirm\n${ONE_TURN}`, log),
    ]);
    const { taskId, turn } = await herd.startTask("zcode", home, "Fix it");
    expect((await turn).stopReason).toBe("end_turn");
    const order = logLines(log);
    expect(order).toContain("mode build");
    expect(order.findIndex((l) => l.startsWith("mode "))).toBeLessThan(
      order.findIndex((l) => l.startsWith("prompt ")),
    );
    const report = channel.ofKind("report").map((m) => m.view as ReportView)[0];
    expect(report?.subtitle).toContain("ZCode");
    expect(herd.tasks().find((t) => t.id === taskId)?.stage).toBe("done");
  });

  it("does not dispatch work when the session refuses the mode", async () => {
    const home = mkdtempSync(join(tmpdir(), "agentherd-prepare-"));
    const log = join(home, "refuse.log");
    const { herd, channel } = await boot(home, [
      zcodeProfile(home, "set_mode: error\nturns: []\n", log),
    ]);
    await expect(herd.startTask("zcode", home, "Fix it")).rejects.toThrow(/set_mode refused/);
    expect(logLines(log).some((l) => l.startsWith("prompt "))).toBe(false);
    const reports = channel.ofKind("report").map((m) => JSON.stringify(m.view));
    expect(reports.some((r) => r.includes("set_mode refused"))).toBe(true);
    expect(herd.openTasks()).toEqual([]);
  });

  it("does not dispatch work when the session reports another mode", async () => {
    const home = mkdtempSync(join(tmpdir(), "agentherd-prepare-"));
    const log = join(home, "wrong.log");
    const { herd } = await boot(home, [zcodeProfile(home, "set_mode: wrong\nturns: []\n", log)]);
    await expect(herd.startTask("zcode", home, "Fix it")).rejects.toThrow(
      /reported mode "yolo" instead of "build"/,
    );
    expect(logLines(log).some((l) => l.startsWith("prompt "))).toBe(false);
  });

  it("re-verifies the mode when it opens the saved session", async () => {
    const home = mkdtempSync(join(tmpdir(), "agentherd-prepare-"));
    const log = join(home, "load.log");
    const { herd } = await boot(home, [
      zcodeProfile(home, `load_session: true\nset_mode: confirm\n${ONE_TURN}`, log),
    ]);
    const { taskId, turn } = await herd.startTask("zcode", home, "Fix it");
    await turn;
    await herd.endTask(taskId, "done");
    await herd.promptTask(taskId, "go on");
    const order = logLines(log);
    const modes = order.flatMap((l, i) => (l.startsWith("mode ") ? [i] : []));
    const loads = order.flatMap((l, i) => (l.startsWith("load ") ? [i] : []));
    const prompts = order.flatMap((l, i) => (l.startsWith("prompt ") ? [i] : []));
    expect(modes).toHaveLength(2);
    expect(loads).toHaveLength(1);
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    // The saved session is loaded, then the mode is confirmed again, then the prompt goes.
    expect(loads[0] ?? -1).toBeLessThan(modes[1] ?? Number.MAX_SAFE_INTEGER);
    expect(modes[1] ?? -1).toBeLessThan(prompts[1] ?? Number.MAX_SAFE_INTEGER);
    expect(herd.store.auditRows("task.reopened").at(-1)?.data).toMatchObject({
      loaded: true,
      profileId: "zcode",
    });
  });

  it("prepares the replacement session when the saved one is gone", async () => {
    const home = mkdtempSync(join(tmpdir(), "agentherd-prepare-"));
    const log = join(home, "replace.log");
    const { herd } = await boot(home, [
      zcodeProfile(
        home,
        `load_session: true\nfail_load: true\nset_mode: confirm\n${ONE_TURN}`,
        log,
      ),
    ]);
    const { taskId, turn } = await herd.startTask("zcode", home, "Fix it");
    await turn;
    await herd.endTask(taskId, "done");
    await herd.promptTask(taskId, "go on");
    const order = logLines(log);
    expect(order.filter((l) => l.startsWith("mode "))).toHaveLength(2);
    expect(order.some((l) => l.startsWith("load refused:"))).toBe(true);
    const firstMode = order.findIndex((l) => l.startsWith("mode "));
    const lastPrompt = order.reduce((at, l, i) => (l.startsWith("prompt ") ? i : at), -1);
    expect(lastPrompt).toBeGreaterThan(firstMode);
    expect(herd.store.auditRows("task.reopened").at(-1)?.data).toMatchObject({ loaded: false });
  });

  it("fails the start with the agent's own reason when a named model is rejected", async () => {
    const home = mkdtempSync(join(tmpdir(), "agentherd-prepare-"));
    const log = join(home, "model.log");
    const { herd } = await boot(home, [
      zcodeProfile(home, "reject_model: true\nset_mode: confirm\nturns: []\n", log),
    ]);
    await expect(
      herd.startTask("zcode", home, "Fix it", "Fix it", "no-such-model"),
    ).rejects.toThrow(/config refused: no model no-such-model/);
    expect(logLines(log).some((l) => l.startsWith("prompt "))).toBe(false);
  });
});

describe("the owner's account choice survives recovery (ADR 0105)", () => {
  it("an ordinary task never falls back to ZCode, not even when reopening", async () => {
    const home = mkdtempSync(join(tmpdir(), "agentherd-prepare-"));
    const zlog = join(home, "ordinary-zcode.log");
    const mlog = join(home, "ordinary-mock.log");
    const { herd } = await boot(home, [
      zcodeProfile(home, `set_mode: confirm\n${ONE_TURN}`, zlog),
      zcodeProfile(home, ONE_TURN, mlog, { id: "mock", plain: true }),
    ]);
    const { taskId, turn } = await herd.startTask("mock", home, "Fix it");
    await turn;
    await herd.endTask(taskId, "done");
    await herd.promptTask(taskId, "go on");
    expect(logLines(mlog).filter((l) => l.startsWith("prompt "))).toHaveLength(2);
    // ZCode was never started: no mode was set, no prompt was sent.
    expect(logLines(zlog)).toEqual([]);
  });

  it("a ZCode task that cannot reopen never starts another agent", async () => {
    const home = mkdtempSync(join(tmpdir(), "agentherd-prepare-"));
    const zlog = join(home, "restart-zcode.log");
    const first = await boot(home, [zcodeProfile(home, `set_mode: confirm\n${ONE_TURN}`, zlog)]);
    const { taskId, turn } = await first.herd.startTask("zcode", home, "Fix it");
    await turn;
    await first.herd.endTask(taskId, "done");
    const before = logLines(zlog).length;
    await shutDown(first);

    // After the restart ZCode is gone; only another agent is installed. The saved task stays
    // recognizable as a ZCode task, so recovery asks the owner instead of switching accounts.
    const second = await boot(home, [
      { id: "mock", name: "Mock", command: [join(home, "no-such-mock")], env: {}, exporter: null },
    ]);
    expect(second.herd.tasks().find((t) => t.id === taskId)).toBeDefined();
    await expect(second.herd.promptTask(taskId, "go on")).rejects.toThrow(
      /^ZCode: ZCode is not installed$/,
    );
    expect(second.herd.openTasks()).toEqual([]);
    // The restart added nothing to ZCode: no prompt went to it.
    expect(logLines(zlog)).toHaveLength(before);
  });
});
