// E2E for ADR 0025: a task started with a model gets that model's env, and the board and the
// report show the model. A real mock agent speaks ACP; a wrapper records its env.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AgentProfile, ReportView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentModels } from "../../src/herd.ts";
import { Herd } from "../../src/herd.ts";
import { Store } from "../../src/store.ts";

const BIN = fileURLToPath(new URL("../../../mock-agent/bin/mock-agent.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "agentherd-model-"));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

const ONE_TURN = `
turns:
  - - message: "done"
    - end_turn: end_turn
`;

/** A profile whose agent writes TEST_MODEL from its env to `out`, then runs the mock agent. */
function profile(out: string): AgentProfile {
  const script = join(dir, "one.yaml");
  writeFileSync(script, ONE_TURN);
  const wrapper = join(dir, "wrap.mjs");
  writeFileSync(
    wrapper,
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(out)}, process.env.TEST_MODEL ?? "(none)");
await import(${JSON.stringify(BIN)});
`,
  );
  return {
    id: "mock",
    name: "Mock",
    command: [process.execPath, wrapper, "--script", script],
    env: { TEST_MODEL: "agent default" },
    exporter: null,
  };
}

const models: AgentModels = {
  list: () => [{ ref: "svc/fast", agents: ["mock"] }],
  envFor: (profileId, ref) => {
    if (profileId !== "mock" || ref !== "svc/fast") throw new Error(`cannot run ${ref}`);
    return { TEST_MODEL: ref };
  },
};

async function setup(out: string) {
  const channel = new FakeChannel("owner");
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    profiles: [profile(out)],
    store: Store.open(":memory:"),
    boardDebounceMs: 10,
    agentModels: models,
  });
  herds.push(herd);
  await herd.start();
  return { channel, herd };
}

describe("E2E-MODEL-PER-TASK", () => {
  it("runs the agent with the chosen model and shows it", async () => {
    const out = join(dir, "env-1.txt");
    const { channel, herd } = await setup(out);
    const { taskId, turn } = await herd.startTask("mock", dir, "fix it", "fix it", "svc/fast");
    await turn;
    expect(readFileSync(out, "utf8")).toBe("svc/fast");
    const task = herd.tasks().find((t) => t.id === taskId);
    expect(task?.model).toBe("svc/fast");
    expect(task?.agent).toBe("Mock · svc/fast");
    const report = channel.ofKind("report").map((m) => m.view as ReportView)[0];
    expect(report?.title).toContain("Mock · svc/fast");
  });

  it("keeps the agent's own settings without a model, and refuses a model it cannot run", async () => {
    const out = join(dir, "env-2.txt");
    const { herd } = await setup(out);
    const { turn } = await herd.startTask("mock", dir, "fix it");
    await turn;
    expect(readFileSync(out, "utf8")).toBe("agent default");
    await expect(herd.startTask("mock", dir, "fix it", "fix it", "svc/other")).rejects.toThrow(
      /cannot run svc\/other/,
    );
  });
});
