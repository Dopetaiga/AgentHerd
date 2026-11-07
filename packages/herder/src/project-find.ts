// Finds project folders by name for the Herder (docs/spec/08-herder-interaction.md §1, ADR 0035).
// The Herder never picks one itself: the owner picks from what this returns.

import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/** Folders never searched below the home folder. */
const SKIP = new Set(["Library", "node_modules", "Applications", "Pictures", "Music", "Movies"]);
export const FIND_DEPTH = 4;
export const FIND_CACHE_MS = 60_000;
export const MAX_CHOICES = 3;

export interface FoundProjects {
  /** Folder name matches (case, `-`, `_`, spaces ignored), most recently changed first. */
  exact: string[];
  /** Similar names, best first. Empty when there is an exact match. */
  similar: string[];
}

/** Lower case without `-`, `_`, `.` and spaces: "PI-Desktop" and "pi_desktop" are both "pidesktop". */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/[-_.\s]+/g, "");
}

interface Repo {
  path: string;
  key: string;
  mtime: number;
}

let cache: { root: string; at: number; repos: Repo[] } | undefined;

/** Git repositories under `root`, `depth` levels down; hidden and {@link SKIP} folders skipped. */
export function listRepos(root: string, depth = FIND_DEPTH, now = Date.now()): Repo[] {
  if (cache !== undefined && cache.root === root && now - cache.at < FIND_CACHE_MS) {
    return cache.repos;
  }
  const repos: Repo[] = [];
  const walk = (dir: string, left: number) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === ".git")) {
      const name = basename(dir);
      let mtime = 0;
      try {
        mtime = statSync(join(dir, ".git")).mtimeMs;
      } catch {
        // Keep 0.
      }
      repos.push({ path: dir, key: nameKey(name), mtime });
      return; // A repository's own folders are not separate projects.
    }
    if (left === 0) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP.has(e.name)) continue;
      walk(join(dir, e.name), left - 1);
    }
  };
  walk(root, depth);
  cache = { root, at: now, repos };
  return repos;
}

/** For tests. */
export function clearFindCache(): void {
  cache = undefined;
}

/** Levenshtein distance, small strings only. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j] ?? 0;
      row[j] = Math.min(cur + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length] ?? 0;
}

/** Projects named like `name` under `root`. */
export function findProjects(root: string, name: string, repos = listRepos(root)): FoundProjects {
  const key = nameKey(name.trim().replace(/^.*\//, ""));
  if (key === "") return { exact: [], similar: [] };
  const exact = repos
    .filter((r) => r.key === key)
    .sort((a, b) => b.mtime - a.mtime)
    .map((r) => r.path);
  if (exact.length > 0) return { exact, similar: [] };
  const scored = repos
    .map((r) => {
      const contains = r.key.includes(key) || key.includes(r.key);
      const d = distance(r.key, key);
      const limit = Math.max(1, Math.floor(Math.max(key.length, r.key.length) / 4));
      return { r, score: contains ? 0 : d, ok: contains || d <= limit };
    })
    .filter((s) => s.ok)
    .sort((a, b) => a.score - b.score || b.r.mtime - a.r.mtime);
  return { exact: [], similar: scored.slice(0, MAX_CHOICES).map((s) => s.r.path) };
}

/**
 * The tool result: what to offer the owner, and how. `unique`: the one exact match, named in the
 * owner's own words, which session_start may use without asking (ADR 0043).
 */
export function foundText(name: string, found: FoundProjects, unique?: string): string {
  if (unique !== undefined) {
    return [
      `One project is named "${name}": ${unique}`,
      "Start the task there (session_start project) without asking the owner.",
    ].join("\n");
  }
  if (found.exact.length > 0) {
    const shown = found.exact.slice(0, MAX_CHOICES);
    const more =
      found.exact.length > MAX_CHOICES
        ? ` (${found.exact.length} found; these are the ${MAX_CHOICES} changed most recently)`
        : "";
    return [
      `Projects named "${name}"${more}:`,
      ...shown.map((p) => `- ${p}`),
      "Ask the owner with these full paths as the options.",
    ].join("\n");
  }
  if (found.similar.length > 0) {
    return [
      `No project is named "${name}". Similar names:`,
      ...found.similar.map((p) => `- ${p}`),
      "Ask the owner with these full paths as the options.",
    ].join("\n");
  }
  return `No project named "${name}" or anything like it. Tell the owner plainly (e.g. "没找到叫 ${name} 的项目") and ask no question with buttons.`;
}
