// Built-in agent profiles. A profile with the same id in config.json replaces a built-in one.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProfile } from "@agentherd/protocol";

const MOCK_BIN = fileURLToPath(new URL("../../mock-agent/bin/mock-agent.ts", import.meta.url));
const PI_ACP_BIN = fileURLToPath(new URL("../../pi-acp/bin/pi-acp.ts", import.meta.url));

/**
 * Env that makes `process.execPath` run a script. Inside Electron's utility process, execPath is
 * the Electron binary, which runs as Node only with ELECTRON_RUN_AS_NODE.
 */
function nodeEnv(): Record<string, string> {
  return process.versions.electron === undefined ? {} : { ELECTRON_RUN_AS_NODE: "1" };
}

/** Folders where npm, Homebrew and installers put CLIs; an app opened from Finder lacks them on PATH. */
export function extraBinDirs(home: string = homedir()): string[] {
  return [
    join(home, ".local/bin"),
    join(home, ".npm-global/bin"),
    join(home, ".bun/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

/**
 * PATH of the user's login shell, then the current PATH, then extraBinDirs(). The login shell is
 * asked once; it fails quietly (no shell, slow profile) and then the other two still apply.
 */
export function searchPath(env: NodeJS.ProcessEnv = process.env): string {
  let login = "";
  const shell = env.SHELL;
  if (shell !== undefined && shell !== "" && process.platform !== "win32") {
    try {
      login = execFileSync(shell, ["-ilc", 'printf "%s" "$PATH"'], {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      login = "";
    }
  }
  const dirs = [...login.split(delimiter), ...(env.PATH ?? "").split(delimiter), ...extraBinDirs()];
  return [...new Set(dirs.filter((d) => d !== ""))].join(delimiter);
}

function onPath(name: string, path: string | undefined, exists: (p: string) => boolean) {
  for (const dir of (path ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

/** Where the DeepSeek Harness desktop app keeps its CLI. */
export const DSH_APP_BIN =
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh";

/** The built-in `mock` profile plays a YAML script. */
export function mockProfile(script: string): AgentProfile {
  return {
    id: "mock",
    name: "Mock agent",
    command: [process.execPath, MOCK_BIN, "--script", script],
    env: nodeEnv(),
    exporter: null,
  };
}

/**
 * Finds the `dsh` binary: `AGENTHERD_DSH`, then `dsh` on `PATH`, then the desktop app bundle.
 * @param env Environment to read `AGENTHERD_DSH` and `PATH` from.
 * @param exists File test, replaceable in tests.
 * @returns The path, or `undefined` when DSH is not installed.
 */
export function findDsh(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const explicit = env.AGENTHERD_DSH;
  if (explicit !== undefined && explicit !== "") return explicit;
  return onPath("dsh", env.PATH, exists) ?? (exists(DSH_APP_BIN) ? DSH_APP_BIN : undefined);
}

/**
 * Finds Pi (`npm i -g @earendil-works/pi-coding-agent`): `AGENTHERD_PI`, then `pi` on `PATH`.
 * @returns The path, or `undefined` when Pi is not installed.
 */
export function findPi(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const explicit = env.AGENTHERD_PI;
  if (explicit !== undefined && explicit !== "") return explicit;
  return onPath("pi", env.PATH, exists);
}

/**
 * The built-in `pi` profile: AgentHerd's ACP bridge in front of Pi (ADR 0022). The bridge's gate
 * asks before every tool call except reads inside the task folder.
 * @param bin Path from `findPi()`.
 * @param modelEnv From `piModelEnv()` when the owner chose a model for Pi; else Pi's own settings.
 */
export function piProfile(bin: string, modelEnv: Record<string, string> = {}): AgentProfile {
  return {
    id: "pi",
    name: "Pi",
    command: [process.execPath, PI_ACP_BIN, "--pi", bin],
    env: { ...nodeEnv(), ...modelEnv },
    exporter: null,
  };
}

/**
 * The built-in `dsh` profile. DSH runs in `read-only` sandbox mode so that every write and
 * network command becomes a permission request (docs/spec/03-agents.md#dsh-approvals).
 * @param bin Path from `findDsh()`.
 */
export function dshProfile(bin: string): AgentProfile {
  return {
    id: "dsh",
    name: "DeepSeek Harness",
    command: [bin, "acp"],
    env: { DSH_PERMISSION_MODE: "read-only" },
    exporter: null,
  };
}

export interface ResolveOptions {
  script?: string | undefined;
  configured: AgentProfile[];
  findDsh?: () => string | undefined;
  findPi?: () => string | undefined;
  /** Env for the `pi` profile's model (see piProfile). */
  piModelEnv?: Record<string, string>;
}

/**
 * Resolves a profile id: config.json profiles first, then built-ins.
 * @throws Error with an actionable message when the id is unknown or the agent is not installed.
 */
export function resolveProfile(id: string, opts: ResolveOptions): AgentProfile {
  const configured = opts.configured.find((p) => p.id === id);
  if (configured !== undefined) return configured;
  if (id === "mock") {
    if (opts.script === undefined) throw new Error("--script is required with the mock profile");
    return mockProfile(opts.script);
  }
  if (id === "dsh") {
    const bin = (opts.findDsh ?? findDsh)();
    if (bin === undefined) {
      throw new Error(
        "DeepSeek Harness not found. Install the desktop app, put `dsh` on PATH, or set AGENTHERD_DSH.",
      );
    }
    return dshProfile(bin);
  }
  if (id === "pi") {
    const bin = (opts.findPi ?? findPi)();
    if (bin === undefined) {
      throw new Error(
        "Pi not found. Install it with `npm i -g @earendil-works/pi-coding-agent`, or set AGENTHERD_PI.",
      );
    }
    return piProfile(bin, opts.piModelEnv);
  }
  const known = ["mock", "dsh", "pi", ...opts.configured.map((p) => p.id)].join(", ");
  throw new Error(`unknown profile "${id}" (known: ${known})`);
}

/**
 * Profiles for `agentherd start`: config.json profiles, then `dsh` and `pi` when installed, then
 * `mock` when a script is given. A configured profile with the same id wins.
 */
export function availableProfiles(opts: ResolveOptions): AgentProfile[] {
  const profiles = [...opts.configured];
  const has = (id: string) => profiles.some((p) => p.id === id);
  const bin = (opts.findDsh ?? findDsh)();
  if (!has("dsh") && bin !== undefined) profiles.push(dshProfile(bin));
  const pi = (opts.findPi ?? findPi)();
  if (!has("pi") && pi !== undefined) profiles.push(piProfile(pi, opts.piModelEnv));
  if (!has("mock") && opts.script !== undefined) profiles.push(mockProfile(opts.script));
  return profiles;
}
