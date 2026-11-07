import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspaces } from "../src/workspace.ts";

let dir: string;
let project: string;
let home: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: project, encoding: "utf8" });
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentherd-ws-"));
  project = join(dir, "demo");
  home = join(dir, "home");
  mkdirSync(project);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "o@example.com");
  git("config", "user.name", "Owner");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(project, "a.txt"), "a1\n");
  writeFileSync(join(project, "b.txt"), "b1\n");
  writeFileSync(join(project, ".gitignore"), "node_modules/\n.env\n");
  git("add", ".");
  git("commit", "-q", "-m", "first");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Workspaces", () => {
  it("gives a git project a copy with the owner's uncommitted files and dependencies", async () => {
    writeFileSync(join(project, "a.txt"), "a2 uncommitted\n");
    writeFileSync(join(project, "new.txt"), "untracked\n");
    mkdirSync(join(project, "node_modules", "x"), { recursive: true });
    writeFileSync(join(project, "node_modules", "x", "index.js"), "dep\n");
    writeFileSync(join(project, ".env"), "KEY=1\n");
    const ws = await new Workspaces(home).create("task-0001-aaaa", project);
    expect(ws.kind).toBe("copy");
    expect(ws.cwd).not.toBe(project);
    expect(read(join(ws.cwd, "a.txt"))).toBe("a2 uncommitted\n");
    expect(read(join(ws.cwd, "new.txt"))).toBe("untracked\n");
    expect(read(join(ws.cwd, "node_modules", "x", "index.js"))).toBe("dep\n");
    expect(lstatSync(join(ws.cwd, "node_modules")).isSymbolicLink()).toBe(true);
    expect(read(join(ws.cwd, ".env"))).toBe("KEY=1\n");
    // The owner sees no new branch and nothing staged.
    expect(git("branch", "--list").trim()).toBe("* main");
    expect(git("diff", "--cached", "--name-only").trim()).toBe("");
  });

  it("copies the task's changes back at the end of a turn and the owner's in at the start", async () => {
    const spaces = new Workspaces(home);
    const ws = await spaces.create("task-0002-bbbb", project);
    writeFileSync(join(ws.cwd, "a.txt"), "task\n");
    writeFileSync(join(ws.cwd, "made.txt"), "made\n");
    rmSync(join(ws.cwd, "b.txt"));
    const result = await spaces.afterTurn(ws, "task-0002-bbbb");
    expect(result.conflicts).toEqual([]);
    expect(result.applied.sort()).toEqual(["a.txt", "b.txt", "made.txt"]);
    expect(read(join(project, "a.txt"))).toBe("task\n");
    expect(read(join(project, "made.txt"))).toBe("made\n");
    expect(existsSync(join(project, "b.txt"))).toBe(false);
    // Uncommitted edits in the project, nothing staged.
    expect(git("diff", "--cached", "--name-only").trim()).toBe("");
    expect(git("log", "--oneline").trim().split("\n")).toHaveLength(1);

    writeFileSync(join(project, "owner.txt"), "owner\n");
    await spaces.beforeTurn(ws);
    expect(read(join(ws.cwd, "owner.txt"))).toBe("owner\n");
  });

  it("keeps the owner's version of a file both changed and names it", async () => {
    const spaces = new Workspaces(home);
    const ws = await spaces.create("task-0003-cccc", project);
    writeFileSync(join(ws.cwd, "a.txt"), "task\n");
    writeFileSync(join(ws.cwd, "b.txt"), "task b\n");
    writeFileSync(join(project, "a.txt"), "owner\n");
    const result = await spaces.afterTurn(ws, "task-0003-cccc");
    expect(result.conflicts).toEqual(["a.txt"]);
    expect(result.applied).toEqual(["b.txt"]);
    expect(read(join(project, "a.txt"))).toBe("owner\n");
    expect(read(join(project, "b.txt"))).toBe("task b\n");
    // The copy now matches the project.
    expect(read(join(ws.cwd, "a.txt"))).toBe("owner\n");
    expect(await spaces.takeTask(ws)).toEqual(["a.txt"]);
    expect(read(join(project, "a.txt"))).toBe("task\n");
  });

  it("removes the copy without touching linked dependencies", async () => {
    mkdirSync(join(project, "node_modules", "x"), { recursive: true });
    writeFileSync(join(project, "node_modules", "x", "index.js"), "dep\n");
    const spaces = new Workspaces(home);
    const ws = await spaces.create("task-0004-dddd", project);
    await spaces.remove(ws);
    expect(existsSync(ws.root ?? "")).toBe(false);
    expect(read(join(project, "node_modules", "x", "index.js"))).toBe("dep\n");
    expect(git("worktree", "list").trim().split("\n")).toHaveLength(1);
  });

  it("runs a folder outside git in place and a task without a project in a scratch folder", async () => {
    const plain = join(dir, "plain");
    mkdirSync(plain);
    const spaces = new Workspaces(home);
    expect(await spaces.create("task-0005-eeee", plain)).toEqual({
      kind: "inplace",
      cwd: plain,
      project: plain,
    });
    const scratch = await spaces.create("task-0006-ffff", undefined);
    expect(scratch.kind).toBe("scratch");
    expect(existsSync(scratch.cwd)).toBe(true);
  });

  it("uses a subfolder of the copy when the task started in a subfolder", async () => {
    mkdirSync(join(project, "pkg"));
    writeFileSync(join(project, "pkg", "p.txt"), "p\n");
    const ws = await new Workspaces(home).create("task-0007-gggg", join(project, "pkg"));
    expect(read(join(ws.cwd, "p.txt"))).toBe("p\n");
  });
});
