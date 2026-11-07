// Task copies (ADR 0043): a task in a git project works on a hidden copy of the owner's working
// tree; its changes come back when each turn ends, and replies to a task's messages reach it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AgentProfile, TextView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { Herd } from "../../src/herd.ts";
import { Store } from "../../src/store.ts";
import { WORKSPACE_TARGET } from "../../src/task-runner.ts";
import { CORE_TEXTS } from "../../src/texts.ts";

const T = CORE_TEXTS["zh-CN"];
/** File text; git may have checked it out with CRLF (core.autocrlf). */
const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const BIN = fileURLToPath(new URL("../../../mock-agent/bin/mock-agent.ts", import.meta.url));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentherd-proj-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  writeFileSync(join(dir, "a.txt"), "two\n");
  mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "dep", "index.js"), "x");
  return dir;
}

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

async function until(check: () => boolean, ms = 10000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("task copies (ADR 0043)", () => {
  it("works on a copy, brings changes back each turn and keeps the owner's on conflict", async () => {
    const proj = project();
    const store = Store.open(":memory:");
    const { channel, herd, home } = herdOn(store);
    await herd.start();
    const { taskId, turn } = await herd.startTask("mock", proj, "改一下");
    await turn;

    const ws = store.task(taskId)?.workspace;
    expect(ws?.kind).toBe("copy");
    const copy = ws?.cwd ?? "";
    expect(copy.startsWith(home)).toBe(true);
    expect(read(join(copy, "a.txt"))).toBe("two\n");
    expect(existsSync(join(copy, "node_modules", "dep", "index.js"))).toBe(true);
    expect(git(proj, "branch", "--list")).toBe("* main");

    // The task's new file reaches the project when its turn ends, as an uncommitted change.
    writeFileSync(join(copy, "new.txt"), "from task\n");
    await herd.promptTask(taskId, "继续");
    expect(read(join(proj, "new.txt"))).toBe("from task\n");
    expect(git(proj, "status", "--porcelain")).toContain("?? new.txt");

    // Both changed a.txt: the owner's version stays until they pick the task's.
    writeFileSync(join(copy, "a.txt"), "task\n");
    writeFileSync(join(proj, "a.txt"), "owner\n");
    await herd.promptTask(taskId, "再改");
    expect(read(join(proj, "a.txt"))).toBe("owner\n");
    const conflict = channel
      .ofKind("text")
      .find((m) => (m.view as TextView).text === T.workspaceConflict(["a.txt"]));
    expect(conflict).toBeDefined();
    await channel.tap(`${WORKSPACE_TARGET}${taskId}`, "take-task");
    expect(read(join(proj, "a.txt"))).toBe("task\n");

    await herd.endTask(taskId, "done");
    expect(existsSync(copy)).toBe(false);
    expect(existsSync(join(proj, "node_modules", "dep", "index.js"))).toBe(true);
  }, 60000);

  it("a reply to a task's message goes to that task, not the Herder", async () => {
    const proj = project();
    const store = Store.open(":memory:");
    const { channel, herd, toHerder } = herdOn(store);
    await herd.start();
    const { taskId, turn } = await herd.startTask("mock", proj, "改一下");
    await turn;
    const report = channel.ofKind("report").find((m) => m.view.taskId === taskId);
    expect(report).toBeDefined();
    await channel.reply(report?.ref ?? { channelId: "fake", id: "none" }, "接着做");
    await until(() => store.task(taskId)?.task.stage !== "working" && audits(store) > 0);
    expect(toHerder).toEqual([]);

    await channel.say("别的事");
    expect(toHerder).toEqual(["别的事"]);
  }, 60000);
});

function audits(store: Store): number {
  return store.auditRows("reply.message").length;
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
