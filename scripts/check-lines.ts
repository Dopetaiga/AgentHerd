#!/usr/bin/env node
// Warns when a source file passes SOFT_LINES and fails when it passes MAX_LINES (AGENTS.md
// "Code"). Runs in `pnpm check`. The ceiling is a guard against runaway files, not a style
// target; split by responsibility long before it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SOFT_LINES = 3500;
export const MAX_LINES = 5000;

export const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".css"];

/** Not ours to split: the forked Pi loop follows upstream file by file (ADR 0020). */
export const EXEMPT = ["packages/herder-loop/src/", "packages/herder-loop/test/"];

/** Lines as an editor shows them; a final newline does not start another line. */
export function countLines(text: string): number {
  if (text === "") return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

export function isChecked(path: string): boolean {
  return EXTENSIONS.some((ext) => path.endsWith(ext)) && !EXEMPT.some((p) => path.startsWith(p));
}

export interface LongFile {
  path: string;
  lines: number;
}

export function longFiles(
  files: ReadonlyArray<{ path: string; text: string }>,
  max = MAX_LINES,
): LongFile[] {
  return files
    .filter((f) => isChecked(f.path))
    .map((f) => ({ path: f.path, lines: countLines(f.text) }))
    .filter((f) => f.lines > max)
    .sort((a, b) => b.lines - a.lines);
}

function main(): number {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  // Tracked and new untracked files, so a file fails before its first commit.
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  );
  const files = [...new Set(listed.split("\0").filter((p) => p !== "" && isChecked(p)))].flatMap(
    (path) => {
      try {
        return [{ path, text: readFileSync(join(root, path), "utf8") }];
      } catch {
        return []; // Deleted in the working tree.
      }
    },
  );
  for (const f of longFiles(files, SOFT_LINES).filter((f) => f.lines <= MAX_LINES)) {
    console.warn(`warning: ${f.path}: ${f.lines} lines (aim for under ${SOFT_LINES})`);
  }
  const long = longFiles(files);
  for (const f of long) console.error(`${f.path}: ${f.lines} lines (limit ${MAX_LINES})`);
  if (long.length > 0) {
    console.error(`\n${long.length} file(s) over ${MAX_LINES} lines. Split by responsibility.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
