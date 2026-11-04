// Built-in agent profiles. A profile with the same id in config.json replaces a built-in one.

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProfile } from "@agentherd/protocol";

const MOCK_BIN = fileURLToPath(new URL("../../mock-agent/bin/mock-agent.ts", import.meta.url));

/** Where the DeepSeek Harness desktop app keeps its CLI. */
export const DSH_APP_BIN =
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh";

/** The built-in `mock` profile plays a YAML script. */
export function mockProfile(script: string): AgentProfile {
  return {
    id: "mock",
    name: "Mock agent",
    command: [process.execPath, MOCK_BIN, "--script", script],
    env: {},
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
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, "dsh");
    if (exists(candidate)) return candidate;
  }
  return exists(DSH_APP_BIN) ? DSH_APP_BIN : undefined;
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
  const known = ["mock", "dsh", ...opts.configured.map((p) => p.id)].join(", ");
  throw new Error(`unknown profile "${id}" (known: ${known})`);
}
