import { describe, expect, it } from "vitest";
import { commandLine, killTree, npmShimTarget } from "../src/command.ts";

// What npm's cmd-shim writes for a global CLI.
const NPM_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*',
].join("\r\n");

describe("npmShimTarget", () => {
  it("finds the script an npm shim runs", () => {
    expect(npmShimTarget("C:\\nodejs\\dsh.cmd", NPM_SHIM)).toBe(
      "C:\\nodejs\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js",
    );
  });
  it("ignores other batch files", () => {
    expect(npmShimTarget("C:\\x\\dsh.cmd", '@echo off\r\n"%~dp0app.exe" %*')).toBeUndefined();
  });
});

describe("commandLine", () => {
  const win = { platform: "win32" as const, node: "C:\\node.exe", comspec: "cmd.exe" };

  it("leaves commands alone outside Windows", () => {
    expect(commandLine("/bin/dsh.cmd", ["acp"], { platform: "darwin" })).toEqual({
      command: "/bin/dsh.cmd",
      args: ["acp"],
      env: {},
    });
  });
  it("leaves executables alone on Windows", () => {
    expect(commandLine("C:\\pi\\pi.exe", ["--mode", "rpc"], win).command).toBe("C:\\pi\\pi.exe");
  });
  it("runs an npm shim's script with Node", () => {
    expect(
      commandLine("C:\\nodejs\\dsh.cmd", ["acp"], { ...win, readText: () => NPM_SHIM }),
    ).toEqual({
      command: "C:\\node.exe",
      args: ["C:\\nodejs\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js", "acp"],
      env: {},
    });
  });
  it("runs any other batch file through cmd.exe", () => {
    const line = commandLine("C:\\Program Files\\DSH\\dsh.cmd", ["acp"], {
      ...win,
      readText: () => "@echo off",
    });
    expect(line).toEqual({
      command: "cmd.exe",
      args: ["/d", "/c", "C:\\Program Files\\DSH\\dsh.cmd", "acp"],
      env: {},
    });
  });
  it("still uses cmd.exe when the batch file cannot be read", () => {
    const line = commandLine("C:\\x\\a.BAT", [], {
      ...win,
      readText: () => {
        throw new Error("EACCES");
      },
    });
    expect(line.command).toBe("cmd.exe");
  });
});

describe("killTree", () => {
  const child = (pid: number | undefined) => {
    const signals: string[] = [];
    return { pid, signals, kill: (s?: NodeJS.Signals) => signals.push(s ?? "") > 0 };
  };

  it("ends the whole process tree on Windows", () => {
    const c = child(42);
    const runs: string[][] = [];
    killTree(c, "SIGTERM", { platform: "win32", run: (cmd, args) => runs.push([cmd, ...args]) });
    expect(runs).toEqual([["taskkill", "/pid", "42", "/t", "/f"]]);
    expect(c.signals).toEqual([]);
  });
  it("sends the signal elsewhere", () => {
    const c = child(42);
    killTree(c, "SIGTERM", { platform: "linux", run: () => expect.unreachable() });
    expect(c.signals).toEqual(["SIGTERM"]);
  });
  it("falls back to kill when the process never started", () => {
    const c = child(undefined);
    killTree(c, "SIGKILL", { platform: "win32", run: () => expect.unreachable() });
    expect(c.signals).toEqual(["SIGKILL"]);
  });
});
