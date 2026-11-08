// E2E for following the pull requests tasks open (docs/spec/04-herder.md "Pull requests"): people's comments
// wake the task and reach the owner, bots do not, failed checks go to the task, a merge is told
// once and ends the watch.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AgentProfile, TextView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../src/clock.ts";
import type { GhRun } from "../../src/github-watch.ts";
import { Herd } from "../../src/herd.ts";
import { Store } from "../../src/store.ts";

const BIN = fileURLToPath(new URL("../../../mock-agent/bin/mock-agent.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "agentherd-github-"));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

const SCRIPT = `
turns:
  - - message: "Opened https://github.com/acme/app/pull/7 and see https://github.com/acme/app/pull/3"
    - end_turn: end_turn
  - - message: "Renamed it."
    - end_turn: end_turn
  - - message: "Fixed the build."
    - end_turn: end_turn
`;

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

interface FakeComment {
  id: number;
  user: { login: string; type: string };
  body: string;
}

/** A GitHub with pull requests acme/app#7 (ours) and #3 (someone else's), read through `gh`. */
class FakeGitHub {
  state = "OPEN";
  checks: { name: string; status: string; conclusion: string }[] = [];
  comments: FakeComment[] = [
    { id: 1, user: { login: "ci-bot[bot]", type: "Bot" }, body: "Preview ready" },
  ];
  reviews: (FakeComment & { state: string })[] = [];
  calls: string[][] = [];
  private nextId = 10;

  comment(login: string, body: string, type = "User"): void {
    this.comments.push({ id: this.nextId++, user: { login, type }, body });
  }

  review(login: string, state: string, body: string): void {
    this.reviews.push({ id: this.nextId++, user: { login, type: "User" }, state, body });
  }

  run: GhRun = async (args) => {
    this.calls.push(args);
    const [cmd, sub] = args;
    if (cmd === "api" && sub === "user") return "me\n";
    if (cmd === "pr" && sub === "view") {
      const mine = args[2] === "7";
      return JSON.stringify({
        state: this.state,
        author: { login: mine ? "me" : "someone" },
        createdAt: "2100-01-01T00:00:00Z",
        headRefOid: `sha${this.checks.length}`,
        statusCheckRollup: this.checks,
      });
    }
    if (cmd === "api" && sub?.includes("/issues/")) return JSON.stringify(this.comments);
    if (cmd === "api" && sub?.includes("/reviews")) return JSON.stringify(this.reviews);
    if (cmd === "api" && sub?.includes("/pulls/")) return "[]";
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
}

async function setup() {
  const channel = new FakeChannel("owner");
  const clock = new FakeClock();
  const store = Store.open(":memory:");
  const github = new FakeGitHub();
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    locale: "en",
    profiles: [profile(SCRIPT)],
    store,
    clock,
    boardDebounceMs: 10,
    github: { run: github.run, pollMinutes: 2 },
  });
  herds.push(herd);
  await herd.start();
  return { herd, channel, clock, store, github };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
}

const texts = (channel: FakeChannel) =>
  channel.messages.filter((m) => m.view.kind === "text").map((m) => (m.view as TextView).text);
const reports = (channel: FakeChannel) => channel.messages.filter((m) => m.view.kind === "report");

describe("E2E-GITHUB", () => {
  it("follows the pull request a task opened until it merges", async () => {
    const { herd, channel, clock, store, github } = await setup();
    const { taskId, turn } = await herd.startTask("mock", dir, "Fix the bug and open a PR");
    await turn;
    // Only the pull request the task opened is followed, not one it mentioned.
    await until(() => store.prWatches().length > 0);
    await until(() => github.calls.some((c) => c[2] === "3"));
    expect(store.prWatches().map((w) => [w.url, w.taskId])).toEqual([
      ["https://github.com/acme/app/pull/7", taskId],
    ]);
    // What was there before is not news.
    await clock.advance(120_000);
    expect(texts(channel).filter((t) => t.includes("PR #7"))).toEqual([]);

    // A person's comment wakes the task, which tells the owner itself; a bot's does neither.
    github.comment("alice", "Please rename foo to bar.\nIt reads better.");
    github.comment("lint-bot[bot]", "Style nits", "Bot");
    await clock.advance(120_000);
    await until(() => reports(channel).length === 2);
    expect(texts(channel).filter((t) => t.startsWith("New comment"))).toEqual([]);
    const prompts = store.transcript(taskId).filter((e) => e.role === "prompt");
    expect(prompts[1]?.text).toContain("alice commented: Please rename foo to bar.");
    expect(prompts[1]?.text).not.toContain("Style nits");

    // A bare approval is told, not worked on.
    github.review("bob", "APPROVED", "");
    await clock.advance(120_000);
    await until(() => texts(channel).includes("PR #7 was approved by bob."));
    expect(texts(channel)).toContain("PR #7 was approved by bob.");
    expect(reports(channel)).toHaveLength(2);

    // Failed checks go to the task once per head commit.
    github.checks = [{ name: "build", status: "COMPLETED", conclusion: "FAILURE" }];
    await clock.advance(120_000);
    await until(() => reports(channel).length === 3);
    const third = store.transcript(taskId).filter((e) => e.role === "prompt");
    expect(third.at(-1)?.text).toContain("Checks failed: build.");
    await clock.advance(120_000);
    expect(reports(channel)).toHaveLength(3);
    // The task reports; no separate notice says the same (ADR 0049).
    expect(texts(channel).filter((t) => t.startsWith("Checks failed"))).toEqual([]);

    // The merge is told once and ends the watch.
    github.state = "MERGED";
    await clock.advance(120_000);
    await until(() => texts(channel).includes("PR #7 was merged."));
    expect(texts(channel)).toContain("PR #7 was merged.");
    expect(store.prWatches()).toEqual([]);
  });

  it("keeps quiet without gh", async () => {
    const { herd, store, clock } = await setup();
    const failing = new Herd({
      home: dir,
      userHome: "/Users/me",
      channel: new FakeChannel("owner"),
      binding: { channelId: "fake", ownerId: "owner", data: {} },
      mode: "assist",
      locale: "en",
      profiles: [profile(SCRIPT)],
      store,
      clock,
      github: {
        run: async () => {
          throw new Error("gh: command not found");
        },
      },
    });
    herds.push(failing);
    await failing.start();
    const { turn } = await failing.startTask("mock", dir, "Open a PR");
    await turn;
    await until(() => store.auditRows("github.error").length > 0);
    expect(store.prWatches()).toEqual([]);
    expect(herd).toBeDefined();
  });
});
