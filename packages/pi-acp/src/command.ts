// How to start Pi. npm installs `pi` as a `#!/usr/bin/env node` script; an app opened from
// Finder may have no `node` on PATH, so such a script runs with this process's Node.

import { closeSync, openSync, readSync, realpathSync } from "node:fs";

function firstLine(path: string): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(200);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString("utf8").split("\n")[0] ?? "";
  } finally {
    closeSync(fd);
  }
}

/**
 * @param bin Path to `pi` (a symlink to the npm script, or a native binary).
 * @param node The Node binary to run a Node script with.
 * @returns The command line that starts Pi.
 */
export function piCommand(bin: string, node: string = process.execPath): string[] {
  let real: string;
  try {
    real = realpathSync(bin);
  } catch {
    return [bin];
  }
  try {
    const line = firstLine(real);
    if (line.startsWith("#!") && /\bnode\b/.test(line)) return [node, real];
  } catch {
    // Not readable: let spawn report it.
  }
  return [real];
}
