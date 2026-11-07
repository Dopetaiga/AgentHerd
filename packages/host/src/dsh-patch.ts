// DSH takes the model a task runs with as a patch overlay file (`dsh --patch <file>`), not env.
// The file holds the provider and model, never the key (that goes in env, see DSH_KEY_ENV).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Writes the overlay under `<home>/run/` (YAML accepts JSON) and returns its path. Files are named
 * after their content, so a model's file is written once and reused by every task that runs it.
 */
export function writeDshPatch(home: string, patch: unknown[]): string {
  const text = `${JSON.stringify(patch, null, 2)}\n`;
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const dir = join(home, "run");
  const file = join(dir, `dsh-model-${hash}.json`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, text, { mode: 0o600 });
  }
  return file;
}

/** The arguments that hand DSH the overlay. */
export function dshPatchArgs(file: string): string[] {
  return ["--patch", file];
}
