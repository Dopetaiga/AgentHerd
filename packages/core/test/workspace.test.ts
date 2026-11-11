import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
});
