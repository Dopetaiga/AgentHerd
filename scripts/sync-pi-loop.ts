#!/usr/bin/env node
// Syncs packages/herder-loop with Pi's agent loop (ADR 0020).
// Three-way merges every mapped file: fork (ours), upstream at the recorded base, upstream at
// the target. See packages/herder-loop/UPSTREAM.md.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const UPSTREAM_URL = "https://github.com/earendil-works/pi.git";
export const MAPPING: ReadonlyArray<{ upstream: string; local: string }> = [
  { upstream: "packages/agent/src/", local: "src/" },
  { upstream: "packages/agent/test/", local: "test/" },
];

const BASE_LINE = /^Base: (\S+) \(([0-9a-f]{40})\)$/m;

export function readBase(upstreamMd: string): { ref: string; sha: string } {
  const m = BASE_LINE.exec(upstreamMd);
  if (!m?.[1] || !m[2]) throw new Error("UPSTREAM.md has no line 'Base: <ref> (<40-char sha>)'");
  return { ref: m[1], sha: m[2] };
}

export function writeBase(upstreamMd: string, ref: string, sha: string): string {
  readBase(upstreamMd);
  return upstreamMd.replace(BASE_LINE, `Base: ${ref} (${sha})`);
}

export function toLocal(upstreamPath: string): string | undefined {
  for (const m of MAPPING) {
    if (upstreamPath.startsWith(m.upstream)) return m.local + upstreamPath.slice(m.upstream.length);
  }
  return undefined;
}

export type FileAction =
  | { kind: "unchanged" }
  | { kind: "update" }
  | { kind: "merge" }
  | { kind: "add" }
  | { kind: "delete" }
  | { kind: "conflict"; reason: string };

/** Decides what to do with one file. `undefined` means the file does not exist there. */
export function classify(
  base: string | undefined,
  target: string | undefined,
  ours: string | undefined,
): FileAction {
  if (base === target) return { kind: "unchanged" };
  if (base === undefined) {
    if (ours === undefined || ours === target) return { kind: "add" };
    return { kind: "conflict", reason: "added upstream, but a different local file exists" };
  }
  if (target === undefined) {
    if (ours === undefined || ours === base) return { kind: "delete" };
    return { kind: "conflict", reason: "deleted upstream, but changed locally" };
  }
  if (ours === undefined)
    return { kind: "conflict", reason: "changed upstream, but deleted locally" };
  if (ours === base || ours === target) return { kind: "update" };
  return { kind: "merge" };
}

export interface MergeResult {
  text: string;
  conflicts: number;
}

/** Three-way merge with `git merge-file`; conflicts leave markers in the text. */
export function mergeText(ours: string, base: string, theirs: string, label: string): MergeResult {
  const dir = mkdtempSync(join(tmpdir(), "sync-pi-loop-"));
  try {
    const o = join(dir, "ours");
    const b = join(dir, "base");
    const t = join(dir, "theirs");
    writeFileSync(o, ours);
    writeFileSync(b, base);
    writeFileSync(t, theirs);
    const r = spawnSync(
      "git",
      ["merge-file", "-L", `${label} (local)`, "-L", "base", "-L", `${label} (upstream)`, o, b, t],
      { encoding: "utf8" },
    );
    if (r.status === null || r.status < 0 || r.status > 127) {
      throw new Error(`git merge-file failed: ${r.stderr}`);
    }
    return { text: readFileSync(o, "utf8"), conflicts: r.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Makes the fork's `dependencies` equal to upstream's (added, changed and removed entries).
 * The fork has no dependencies of its own; AgentHerd code lives in other packages.
 */
export function syncDeps(
  localPkg: string,
  upstreamPkg: string,
): {
  text: string;
  changes: Array<{ name: string; from: string | undefined; to: string | undefined }>;
} {
  const local = JSON.parse(localPkg) as { dependencies?: Record<string, string> };
  const target =
    (JSON.parse(upstreamPkg) as { dependencies?: Record<string, string> }).dependencies ?? {};
  const current = local.dependencies ?? {};
  const changes: Array<{ name: string; from: string | undefined; to: string | undefined }> = [];
  for (const name of [...new Set([...Object.keys(current), ...Object.keys(target)])].sort()) {
    if (current[name] !== target[name])
      changes.push({ name, from: current[name], to: target[name] });
  }
  if (!changes.length) return { text: localPkg, changes };
  local.dependencies = Object.fromEntries(
    Object.entries(target).sort(([a], [b]) => a.localeCompare(b)),
  );
  return { text: `${JSON.stringify(local, null, 2)}\n`, changes };
}

// ---- git access -------------------------------------------------------------------------

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
}

function resolveSha(repo: string, ref: string): string {
  return git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}

function listFiles(repo: string, sha: string): string[] {
  const prefixes = MAPPING.map((m) => m.upstream);
  return git(repo, ["ls-tree", "-r", "--name-only", sha, "--", ...prefixes])
    .split("\n")
    .filter(Boolean);
}

function show(repo: string, sha: string, path: string): string {
  return git(repo, ["show", `${sha}:${path}`]);
}

function findRepo(explicit: string | undefined): string {
  const repo = explicit ?? process.env.PI_REPO;
  if (repo) return resolve(repo);
  const cache = join(homedir(), ".cache", "agentherd", "pi");
  if (existsSync(join(cache, ".git"))) {
    git(cache, ["fetch", "--tags", "--quiet", "origin"]);
  } else {
    mkdirSync(dirname(cache), { recursive: true });
    execFileSync("git", ["clone", "--quiet", UPSTREAM_URL, cache], { stdio: "inherit" });
  }
  return cache;
}

// ---- sync -------------------------------------------------------------------------------

export interface SyncOptions {
  /** Pi clone. */
  repo: string;
  /** packages/herder-loop directory. */
  pkgDir: string;
  /** Tag or sha. */
  to: string;
  dryRun?: boolean;
}

export interface SyncReport {
  from: { ref: string; sha: string };
  to: { ref: string; sha: string };
  files: Array<{ path: string; action: FileAction["kind"]; detail?: string }>;
  deps: Array<{ name: string; from: string | undefined; to: string | undefined }>;
  conflicts: number;
}

export function sync(opts: SyncOptions): SyncReport {
  const mdPath = join(opts.pkgDir, "UPSTREAM.md");
  const md = readFileSync(mdPath, "utf8");
  const from = readBase(md);
  const toSha = resolveSha(opts.repo, opts.to);
  const report: SyncReport = {
    from,
    to: { ref: opts.to, sha: toSha },
    files: [],
    deps: [],
    conflicts: 0,
  };
  const paths = new Set([...listFiles(opts.repo, from.sha), ...listFiles(opts.repo, toSha)]);
  const baseFiles = new Set(listFiles(opts.repo, from.sha));
  const targetFiles = new Set(listFiles(opts.repo, toSha));

  for (const upstreamPath of [...paths].sort()) {
    const local = toLocal(upstreamPath);
    if (!local) continue;
    const localPath = join(opts.pkgDir, local);
    const base = baseFiles.has(upstreamPath) ? show(opts.repo, from.sha, upstreamPath) : undefined;
    const target = targetFiles.has(upstreamPath) ? show(opts.repo, toSha, upstreamPath) : undefined;
    const ours = existsSync(localPath) ? readFileSync(localPath, "utf8") : undefined;
    const action = classify(base, target, ours);
    if (action.kind === "unchanged") continue;

    const entry: SyncReport["files"][number] = { path: local, action: action.kind };
    switch (action.kind) {
      case "update":
      case "add":
        if (!opts.dryRun) {
          mkdirSync(dirname(localPath), { recursive: true });
          writeFileSync(localPath, target ?? "");
        }
        break;
      case "delete":
        if (!opts.dryRun && ours !== undefined) rmSync(localPath);
        break;
      case "merge": {
        const merged = mergeText(ours ?? "", base ?? "", target ?? "", local);
        if (merged.conflicts > 0) {
          entry.action = "conflict";
          entry.detail = `${merged.conflicts} conflict(s), markers written`;
          report.conflicts += 1;
        }
        if (!opts.dryRun) writeFileSync(localPath, merged.text);
        break;
      }
      case "conflict":
        entry.detail = action.reason;
        report.conflicts += 1;
        break;
    }
    report.files.push(entry);
  }

  const pkgPath = join(opts.pkgDir, "package.json");
  const deps = syncDeps(
    readFileSync(pkgPath, "utf8"),
    show(opts.repo, toSha, "packages/agent/package.json"),
  );
  report.deps = deps.changes;
  if (!opts.dryRun) {
    if (deps.changes.length) writeFileSync(pkgPath, deps.text);
    if (report.conflicts === 0) writeFileSync(mdPath, writeBase(md, opts.to, toSha));
  }
  return report;
}

function formatReport(r: SyncReport, dryRun: boolean): string {
  const lines = [
    `${dryRun ? "[dry run] " : ""}Pi agent loop: ${r.from.ref} (${r.from.sha.slice(0, 7)}) → ${r.to.ref} (${r.to.sha.slice(0, 7)})`,
  ];
  if (!r.files.length) lines.push("  no file changes");
  for (const f of r.files)
    lines.push(`  ${f.action.padEnd(8)} ${f.path}${f.detail ? `  — ${f.detail}` : ""}`);
  for (const d of r.deps)
    lines.push(`  dep      ${d.name}: ${d.from ?? "(none)"} → ${d.to ?? "(removed)"}`);
  if (r.conflicts) {
    lines.push(`${r.conflicts} conflict(s). Resolve them, then set the Base line in UPSTREAM.md.`);
  } else if (!dryRun) {
    lines.push("Base line updated. Next: pnpm install && pnpm check && pnpm test");
  }
  return lines.join("\n");
}

function main(argv: string[]): number {
  let to: string | undefined;
  let repo: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--to") to = argv[++i];
    else if (a === "--repo") repo = argv[++i];
    else if (a === "--dry-run") dryRun = true;
    else {
      console.error(`unknown argument: ${a}`);
      return 2;
    }
  }
  if (!to) {
    console.error("usage: sync-pi-loop --to <tag|sha> [--repo <pi clone>] [--dry-run]");
    return 2;
  }
  const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "../packages/herder-loop");
  try {
    const report = sync({ repo: findRepo(repo), pkgDir, to, dryRun });
    console.log(formatReport(report, dryRun));
    return report.conflicts ? 1 : 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
