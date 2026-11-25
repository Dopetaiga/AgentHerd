// Shared helpers for the qualification harnesses (evidence only, not shipped).

import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const HOME = homedir();
export const TEMP = tmpdir();

export function redact(text: string): string {
  return text
    .split(HOME)
    .join("~")
    .split(TEMP)
    .join("%TEMP%")
    .replaceAll(/(?:sk|key|token|secret)[_-][A-Za-z0-9_-]{12,}/gi, "<token>")
    .replaceAll(/[\w.+-]+@[\w.-]+\.\w+/g, "<email>");
}

export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out;
  }
  return value;
}

/** Finds a command on PATH with Windows PATHEXT, like the host's commandCandidates: on Windows
 * only a name with an extension runs (npm's extensionless sh shim must not be picked). */
export function findOnPath(name: string): string | undefined {
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";");
  for (const dir of (process.env.PATH ?? "").split(";")) {
    if (dir === "") continue;
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext.toLowerCase()}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
