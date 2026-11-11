// Task folders (ADR 0043): a folder outside git runs in place; work without a project gets a
// scratch folder of its own.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AgentProfile } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { Herd } from "../../src/herd.ts";
import { Store } from "../../src/store.ts";
import { CORE_TEXTS } from "../../src/texts.ts";

const T = CORE_TEXTS["zh-CN"];
const BIN = fileURLToPath(new URL("../../../mock-agent/bin/mock-agent.ts", import.meta.url));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

function herdOn(store: Store) {
  const home = mkdtempSync(join(tmpdir(), "agentherd-home-"));
  const script = join(home, "script.yaml");
  writeFileSync(script, "turns: []\n");
  const profile: AgentProfile = {
    id: "mock",
    name: "Mock",
    command: [process.execPath, BIN, "--script", script],
    env: {},
    exporter: null,
  };
  const channel = new FakeChannel("owner");
  const toHerder: string[] = [];
  const herd = new Herd({
    home,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    profiles: [profile],
    store,
    boardDebounceMs: 10,
    herder: () => ({
      ownerMessage: (text: string) => {
        toHerder.push(text);
      },
      ownerAnswer: () => {},
      event: () => {},
      stop: async () => {},
    }),
  });
  herds.push(herd);
  return { channel, herd, home, toHerder };
}

describe("projects that are not git repositories", () => {
  it("run in place, and work without a project gets a folder of its own", async () => {
    const plain = mkdtempSync(join(tmpdir(), "agentherd-plain-"));
    const store = Store.open(":memory:");
    const { herd, home } = herdOn(store);
    await herd.start();
    const a = await herd.startTask("mock", plain, "看看");
    await a.turn;
    expect(store.task(a.taskId)?.workspace).toMatchObject({ kind: "inplace", cwd: plain });
    const b = await herd.startTask("mock", undefined, "写个脚本");
    await b.turn;
    const scratch = store.task(b.taskId)?.workspace;
    expect(scratch?.kind).toBe("scratch");
    expect(scratch?.cwd.startsWith(home)).toBe(true);
    expect(store.task(b.taskId)?.task.project).toBe(T.noProject);
  }, 60000);
});
