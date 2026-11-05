// Built-in agent profiles. A profile with the same id in config.json replaces a built-in one.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProfile } from "@agentherd/protocol";
import { AGENTS, agentDef, agentProfile, DSH_APP_LAUNCHER } from "./catalog.ts";
import { nodeEnv } from "./runtimes.ts";

const MOCK_BIN = fileURLToPath(new URL("../../mock-agent/bin/mock-agent.ts", import.meta.url));
const PI_ACP_BIN = fileURLToPath(new URL("../../pi-acp/bin/pi-acp.ts", import.meta.url));

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

/**
 * Paths a command `name` may have in `dir`. On Windows only names with a PATHEXT extension run;
 * npm puts an extensionless shell script beside its `.cmd` shim, which must not be picked.
 */
export function commandCandidates(
  dir: string,
  name: string,
  platform: NodeJS.Platform = process.platform,
  pathext: string | undefined = process.env.PATHEXT,
): string[] {
  if (platform !== "win32") return [posix.join(dir, name)];
  const exts = (pathext ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((e) => e !== "");
  if (exts.some((e) => name.toLowerCase().endsWith(e.toLowerCase()))) {
    return [win32.join(dir, name)];
  }
  return exts.map((e) => win32.join(dir, `${name}${e.toLowerCase()}`));
}

/** The first of `names` found on `path` (a PATH value), searching folder by folder. */
export function onPath(
  names: readonly string[],
  path: string | undefined,
  exists: (p: string) => boolean,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const sep = platform === "win32" ? win32.delimiter : posix.delimiter;
  for (const dir of (path ?? "").split(sep)) {
    if (dir === "") continue;
    for (const name of names) {
      const found = commandCandidates(dir, name, platform).find((c) => exists(c));
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Where the DeepSeek Harness desktop app keeps its CLI. */
export const DSH_APP_BIN = `/Applications/${DSH_APP_LAUNCHER}`;

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
 * Finds an agent's CLI without the app's downloads: its env variable (`AGENTHERD_DSH`, …), then
 * its command on `PATH`, then (DSH) the desktop app bundle.
 * @returns The path, or `undefined` when it is not installed.
 */
export function findAgent(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const def = agentDef(id);
  if (def === undefined) return undefined;
  const explicit = env[def.envVar];
  if (explicit !== undefined && explicit !== "") return explicit;
  const found = onPath(def.systemNames, env.PATH, exists, platform);
  if (found !== undefined) return found;
  return id === "dsh" && platform !== "win32" && exists(DSH_APP_BIN) ? DSH_APP_BIN : undefined;
}

/**
 * The built-in `pi` profile: AgentHerd's ACP bridge in front of Pi (ADR 0022). The bridge's gate
 * asks before every tool call except reads inside the task folder.
 * @param bin Path of Pi's CLI.
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
 * The profile that starts agent `id` from `bin`: Pi behind the bridge, the others with their
 * ACP arguments and the env that makes them ask before writing (catalog.ts).
 */
export function builtinProfile(
  id: string,
  bin: string,
  piModelEnv: Record<string, string> = {},
): AgentProfile | undefined {
  if (id === "pi") return piProfile(bin, piModelEnv);
  const def = agentDef(id);
  return def === undefined ? undefined : agentProfile(def, bin);
}

export interface ResolveOptions {
  script?: string | undefined;
  configured: AgentProfile[];
  /** Path of an agent's CLI. Default: findAgent(). */
  find?: (id: string) => string | undefined;
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
  const def = agentDef(id);
  if (def !== undefined) {
    const bin = (opts.find ?? ((x: string) => findAgent(x)))(id);
    if (bin === undefined) {
      throw new Error(
        `${def.name} not found. Download it on the Agent page of the desktop app, or set ${def.envVar}.`,
      );
    }
    return builtinProfile(id, bin, opts.piModelEnv) as AgentProfile;
  }
  const known = ["mock", ...AGENTS.map((a) => a.id), ...opts.configured.map((p) => p.id)];
  throw new Error(`unknown profile "${id}" (known: ${known.join(", ")})`);
}

/**
 * Profiles for `agentherd start`: config.json profiles, then each built-in agent that is
 * installed, then `mock` when a script is given. A configured profile with the same id wins.
 */
export function availableProfiles(opts: ResolveOptions): AgentProfile[] {
  const profiles = [...opts.configured];
  const has = (id: string) => profiles.some((p) => p.id === id);
  const find = opts.find ?? ((x: string) => findAgent(x));
  for (const def of AGENTS) {
    if (has(def.id)) continue;
    const bin = find(def.id);
    const profile = bin === undefined ? undefined : builtinProfile(def.id, bin, opts.piModelEnv);
    if (profile !== undefined) profiles.push(profile);
  }
  if (!has("mock") && opts.script !== undefined) profiles.push(mockProfile(opts.script));
  return profiles;
}
