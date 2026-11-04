import path from "node:path";

export interface PathContext {
  cwd: string;
  home: string;
}

/**
 * Resolve a word that may be a path. `~`, `$HOME` and `${HOME}` expand to `home`; relative
 * paths resolve against `cwd`. Returns `null` when the word holds another variable, because
 * its value is unknown.
 */
export function resolveWord(word: string, ctx: PathContext): string | null {
  let w = word;
  if (w === "~" || w.startsWith("~/")) w = ctx.home + w.slice(1);
  w = w.replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, ctx.home);
  if (w.includes("$")) return null;
  return path.resolve(ctx.cwd, w);
}

/** True when `target` is `dir` or inside it. Both must be absolute. */
export function isInside(target: string, dir: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Values a word may carry as a path: the word itself, the part after `=` in `--opt=value`, and
 * the part after a leading `@` (`curl -d @file`).
 */
export function pathCandidates(word: string): string[] {
  const eq = word.indexOf("=");
  const value = word.startsWith("-") && eq !== -1 ? word.slice(eq + 1) : word;
  return value.startsWith("@") && value.length > 1 ? [value, value.slice(1)] : [value];
}
