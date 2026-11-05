// Mass delete: the one kind of agent request that still goes to the owner (ADR 0029). Everything
// else is approved by AgentHerd. "Mass" means the target is the project folder itself, a folder
// above it, the home folder, `/`, anything outside the project, everything in a folder (`*`), or
// targets nobody can know before the command runs (a variable, `xargs`, `find -delete`).
// It is coarse on purpose: a false hit costs one tap, a miss can cost a project.

import path from "node:path";
import type { ToolCallInfo } from "@agentherd/protocol";
import type { GuardResult } from "./guard.ts";
import { isInside, type PathContext, resolveWord } from "./paths.ts";
import { basename, programWords, splitCommand, UnparsedCommandError } from "./shell.ts";

export const MASS_DELETE = { id: "mass-delete", reason: "Deletes a lot at once" } as const;

const MISS: GuardResult = { hit: false };
const HIT: GuardResult = { hit: true, ...MASS_DELETE };

/** True when deleting `word` would remove more than files the agent can name one by one. */
function isWide(word: string, ctx: PathContext, here: string = ctx.cwd): boolean {
  // `src/*.log` is narrow; `*`, `./*`, `dir/*` or `.*` empties a folder.
  const base = path.basename(word);
  if (base === "*" || base === ".*") return true;
  const resolved = resolveWord(word.replace(/\/\*$/, "") || "/", { ...ctx, cwd: here });
  if (resolved === null) return true;
  if (!isInside(resolved, ctx.cwd)) return true;
  if (resolved === path.resolve(ctx.cwd)) return true;
  return false;
}

function rmTargets(args: readonly string[]): string[] {
  const targets: string[] = [];
  let endOfOptions = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string;
    if (!endOfOptions && word === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && /^\d*(>>?|<|&>>?)&?$/.test(word)) {
      i += 1;
      continue;
    }
    if (!endOfOptions && word.startsWith("-") && word !== "-") continue;
    targets.push(word);
  }
  return targets;
}

/** Whether an agent request deletes a lot at once. */
export function massDeleteCheck(call: ToolCallInfo, ctx: PathContext): GuardResult {
  if (call.kind === "delete" && call.paths.some((p) => isWide(p, ctx))) return HIT;
  if (call.command === undefined || call.command.trim() === "") return MISS;
  let segments: ReturnType<typeof splitCommand>;
  try {
    segments = splitCommand(call.command);
  } catch (error) {
    // A command we cannot read may delete anything; only ask when it mentions a delete.
    if (error instanceof UnparsedCommandError) {
      return /\brm\b|-delete\b|\brmdir\b/.test(call.command) ? HIT : MISS;
    }
    throw error;
  }
  // `cd somewhere && rm -r x` deletes relative to where it went.
  let here: string | null = ctx.cwd;
  for (const segment of segments) {
    const words = programWords(segment.words);
    const program = basename(words[0] ?? "");
    const args = words.slice(1);
    if (program === "cd") {
      here = here === null ? null : resolveWord(args[0] ?? "~", { ...ctx, cwd: here });
      continue;
    }
    if (program === "rm" || program === "rmdir" || program === "trash") {
      const targets = rmTargets(args);
      if (targets.length > 0 && here === null) return HIT;
      if (here !== null && targets.some((t) => isWide(t, ctx, here as string))) return HIT;
    }
    if (program === "xargs") {
      const inner = programWords(args.filter((w) => !w.startsWith("-")));
      if (basename(inner[0] ?? "") === "rm") return HIT;
    }
    if (program === "find") {
      // `find . -name '*.tmp' -delete` picks files by name; without a filter it empties a folder.
      const filtered = args.some((w) => /^-i?(name|path|regex|wholename)$/.test(w));
      const deletes =
        !filtered &&
        (args.includes("-delete") ||
          args.some(
            (w, i) => (w === "-exec" || w === "-execdir") && basename(args[i + 1] ?? "") === "rm",
          ));
      if (deletes) return HIT;
    }
  }
  return MISS;
}
