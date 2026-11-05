import type { ToolCallInfo } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import { massDeleteCheck } from "../src/mass-delete.ts";

const ctx = { cwd: "/p/app", home: "/Users/me" };
const run = (command: string): ToolCallInfo => ({
  kind: "execute",
  title: command,
  command,
  paths: [],
});

describe("massDeleteCheck", () => {
  it.each([
    "rm -rf .",
    "rm -rf *",
    "rm -rf ./*",
    "rm -rf src/*",
    "rm -rf .*",
    "rm -rf ../other",
    "rm -rf ~",
    "rm -rf /",
    "rm -rf /p/app",
    "rm -rf $DIR",
    "cd /tmp && rm -rf x",
    "echo $(rm -rf .)",
    "find . -delete",
    "find . -type f -exec rm {} +",
    "git ls-files | xargs rm",
  ])("asks for %s", (command) => {
    expect(massDeleteCheck(run(command), ctx).hit).toBe(true);
  });

  it.each([
    "ls -la",
    "rm -rf node_modules",
    "rm src/*.log",
    "rm a.txt b.txt",
    "find . -name '*.tmp' -delete",
    "git clean -fdx",
    "git reset --hard",
    "git push --force",
    "sudo ls",
    "cd src && rm -rf build",
  ])("approves %s", (command) => {
    expect(massDeleteCheck(run(command), ctx).hit).toBe(false);
  });

  it("asks when a delete tool targets the project folder, not a file in it", () => {
    const del = (p: string): ToolCallInfo => ({ kind: "delete", title: "Delete", paths: [p] });
    expect(massDeleteCheck(del("/p/app"), ctx).hit).toBe(true);
    expect(massDeleteCheck(del("/p/app/a.ts"), ctx).hit).toBe(false);
  });
});
