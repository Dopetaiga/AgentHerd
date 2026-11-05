// How to spawn an agent's command line. On Windows, Node cannot spawn a `.cmd` or `.bat` file
// directly (EINVAL since the CVE-2024-27980 fix). npm installs global CLIs as such `.cmd` shims, so
// a shim that just runs a Node script is replaced by that script under this process's Node. Any
// other batch file runs through `cmd.exe`.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { win32 } from "node:path";

export interface CommandLine {
  command: string;
  args: string[];
  /** Env the command needs on top of the caller's (Electron runs as Node only with this). */
  env: Record<string, string>;
}

export interface CommandOptions {
  platform?: NodeJS.Platform;
  /** Reads a shim; default: the file system. */
  readText?: (path: string) => string;
  /** The Node binary that runs a shim's script. Default: this process's. */
  node?: string;
  /** Default: %ComSpec%, else cmd.exe. */
  comspec?: string;
}

const BATCH = /\.(cmd|bat)$/i;
// npm's cmd-shim: `"%_prog%"  "%dp0%\node_modules\pkg\bin\cli.js" %*`.
const NPM_SHIM = /"%_prog%"\s+"%dp0%\\([^"]+\.(?:c|m)?js)"/i;

/** The script an npm `.cmd` shim runs, or undefined when `text` is not such a shim. */
export function npmShimTarget(shim: string, text: string): string | undefined {
  const match = text.match(NPM_SHIM);
  if (match?.[1] === undefined) return undefined;
  return win32.join(win32.dirname(shim), match[1]);
}

/** The command line that starts `command args` on this platform. */
export function commandLine(
  command: string,
  args: readonly string[],
  opts: CommandOptions = {},
): CommandLine {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32" || !BATCH.test(command)) return { command, args: [...args], env: {} };
  let text = "";
  try {
    text = (opts.readText ?? ((p) => readFileSync(p, "utf8")))(command);
  } catch {
    // Not readable: cmd.exe will report it.
  }
  const script = npmShimTarget(command, text);
  if (script !== undefined) {
    const electron = opts.node === undefined && process.versions.electron !== undefined;
    return {
      command: opts.node ?? process.execPath,
      args: [script, ...args],
      env: electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
    };
  }
  // Without /s, cmd keeps the quotes Node puts around a path with spaces.
  const comspec = opts.comspec ?? process.env.ComSpec ?? "cmd.exe";
  return { command: comspec, args: ["/d", "/c", command, ...args], env: {} };
}

export interface KillOptions {
  platform?: NodeJS.Platform;
  /** Starts `taskkill`; default: spawn. */
  run?: (command: string, args: string[]) => void;
}

/**
 * Stops `child` and, on Windows, every process it started. There a batch file runs under
 * `cmd.exe`, and killing `cmd.exe` would leave the agent it started running and holding its
 * working folder, so `taskkill /t` ends the whole tree (always forcefully: Windows has no SIGTERM).
 */
export function killTree(
  child: { pid?: number | undefined; kill(signal?: NodeJS.Signals): boolean },
  signal: NodeJS.Signals,
  opts: KillOptions = {},
): void {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32" || child.pid === undefined) {
    child.kill(signal);
    return;
  }
  const run =
    opts.run ??
    ((command: string, args: string[]) => {
      const taskkill = spawn(command, args, { stdio: "ignore", windowsHide: true });
      // Without taskkill, at least the direct child goes.
      taskkill.on("error", () => child.kill(signal));
    });
  run("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
}
