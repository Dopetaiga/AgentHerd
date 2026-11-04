import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classify,
  mergeText,
  readBase,
  sync,
  syncDeps,
  toLocal,
  writeBase,
} from "../sync-pi-loop.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "sync-test-"));
  dirs.push(d);
  return d;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function write(root: string, files: Record<string, string | null>): void {
  for (const [p, text] of Object.entries(files)) {
    const full = join(root, p);
    if (text === null) {
      rmSync(full, { force: true });
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

const pkg = (aiVersion: string) =>
  `${JSON.stringify({ name: "x", dependencies: { "@earendil-works/pi-ai": aiVersion, typebox: "1.0.0" } }, null, 2)}\n`;

/** Upstream repo with two commits; returns repo path and both shas. */
function upstream(v1: Record<string, string | null>, v2: Record<string, string | null>) {
  const repo = tmp();
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "t@t");
  git(repo, "config", "user.name", "t");
  write(repo, { "packages/agent/package.json": pkg("1.0.0"), ...v1 });
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "v1");
  git(repo, "tag", "v1");
  const sha1 = git(repo, "rev-parse", "HEAD");
  write(repo, { "packages/agent/package.json": pkg("2.0.0"), ...v2 });
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "v2");
  git(repo, "tag", "v2");
  return { repo, sha1, sha2: git(repo, "rev-parse", "HEAD") };
}

/** Fork directory at v1 with optional local edits. */
function fork(sha1: string, files: Record<string, string | null>) {
  const dir = tmp();
  write(dir, {
    "UPSTREAM.md": `# x\n\nBase: v1 (${sha1})\n\nmore\n`,
    "package.json": pkg("1.0.0"),
    ...files,
  });
  return dir;
}

const LINES = (n: number, edit: Record<number, string> = {}) =>
  `${Array.from({ length: n }, (_, i) => edit[i] ?? `line ${i}`).join("\n")}\n`;

describe("pure helpers", () => {
  it("reads and writes the base line", () => {
    const sha = "a".repeat(40);
    const md = `x\nBase: v1.4.0 (${sha})\ny\n`;
    expect(readBase(md)).toEqual({ ref: "v1.4.0", sha });
    expect(readBase(writeBase(md, "v1.5.0", "b".repeat(40)))).toEqual({
      ref: "v1.5.0",
      sha: "b".repeat(40),
    });
    expect(() => readBase("no base")).toThrow(/Base/);
  });

  it("maps upstream paths", () => {
    expect(toLocal("packages/agent/src/agent.ts")).toBe("src/agent.ts");
    expect(toLocal("packages/agent/test/utils/x.ts")).toBe("test/utils/x.ts");
    expect(toLocal("packages/agent/package.json")).toBeUndefined();
    expect(toLocal("packages/ai/src/x.ts")).toBeUndefined();
  });

  it("classifies files", () => {
    expect(classify("a", "a", "z").kind).toBe("unchanged");
    expect(classify("a", "b", "a").kind).toBe("update");
    expect(classify("a", "b", "b").kind).toBe("update");
    expect(classify("a", "b", "c").kind).toBe("merge");
    expect(classify(undefined, "b", undefined).kind).toBe("add");
    expect(classify(undefined, "b", "c").kind).toBe("conflict");
    expect(classify("a", undefined, "a").kind).toBe("delete");
    expect(classify("a", undefined, "c").kind).toBe("conflict");
    expect(classify("a", "b", undefined).kind).toBe("conflict");
  });

  it("merges non-overlapping edits and marks overlapping ones", () => {
    const base = LINES(10);
    const clean = mergeText(LINES(10, { 1: "local" }), base, LINES(10, { 8: "upstream" }), "f");
    expect(clean.conflicts).toBe(0);
    expect(clean.text).toBe(LINES(10, { 1: "local", 8: "upstream" }));
    const bad = mergeText(LINES(10, { 4: "local" }), base, LINES(10, { 4: "upstream" }), "f");
    expect(bad.conflicts).toBe(1);
    expect(bad.text).toContain("<<<<<<< f (local)");
  });

  it("syncs pinned dependency versions only", () => {
    const r = syncDeps(pkg("1.0.0"), pkg("2.0.0"));
    expect(r.changes).toEqual([{ name: "@earendil-works/pi-ai", from: "1.0.0", to: "2.0.0" }]);
    expect(JSON.parse(r.text).dependencies["@earendil-works/pi-ai"]).toBe("2.0.0");
    expect(syncDeps(pkg("1.0.0"), pkg("1.0.0")).changes).toEqual([]);
  });
});

describe("sync against a git repo", () => {
  it("updates, merges, adds and deletes; then moves the base", () => {
    const { repo, sha1, sha2 } = upstream(
      {
        "packages/agent/src/a.ts": "a1\n",
        "packages/agent/src/b.ts": LINES(10),
        "packages/agent/src/gone.ts": "old\n",
        "packages/agent/src/same.ts": "same\n",
      },
      {
        "packages/agent/src/a.ts": "a2\n",
        "packages/agent/src/b.ts": LINES(10, { 8: "upstream" }),
        "packages/agent/src/gone.ts": null,
        "packages/agent/test/new.test.ts": "new\n",
      },
    );
    const dir = fork(sha1, {
      "src/a.ts": "a1\n",
      "src/b.ts": LINES(10, { 1: "local" }),
      "src/gone.ts": "old\n",
      "src/same.ts": "same\n",
    });

    const dry = sync({ repo, pkgDir: dir, to: "v2", dryRun: true });
    expect(dry.conflicts).toBe(0);
    expect(readFileSync(join(dir, "src/a.ts"), "utf8")).toBe("a1\n");

    const r = sync({ repo, pkgDir: dir, to: "v2" });
    expect(r.conflicts).toBe(0);
    expect(Object.fromEntries(r.files.map((f) => [f.path, f.action]))).toEqual({
      "src/a.ts": "update",
      "src/b.ts": "merge",
      "src/gone.ts": "delete",
      "test/new.test.ts": "add",
    });
    expect(readFileSync(join(dir, "src/a.ts"), "utf8")).toBe("a2\n");
    expect(readFileSync(join(dir, "src/b.ts"), "utf8")).toBe(
      LINES(10, { 1: "local", 8: "upstream" }),
    );
    expect(existsSync(join(dir, "src/gone.ts"))).toBe(false);
    expect(readFileSync(join(dir, "test/new.test.ts"), "utf8")).toBe("new\n");
    expect(r.deps).toEqual([{ name: "@earendil-works/pi-ai", from: "1.0.0", to: "2.0.0" }]);
    expect(readBase(readFileSync(join(dir, "UPSTREAM.md"), "utf8"))).toEqual({
      ref: "v2",
      sha: sha2,
    });
  });

  it("reports conflicts and keeps the base", () => {
    const { repo, sha1 } = upstream(
      { "packages/agent/src/b.ts": LINES(10) },
      { "packages/agent/src/b.ts": LINES(10, { 4: "upstream" }) },
    );
    const dir = fork(sha1, { "src/b.ts": LINES(10, { 4: "local" }) });
    const r = sync({ repo, pkgDir: dir, to: "v2" });
    expect(r.conflicts).toBe(1);
    expect(r.files[0]?.action).toBe("conflict");
    expect(readFileSync(join(dir, "src/b.ts"), "utf8")).toContain(">>>>>>> src/b.ts (upstream)");
    expect(readBase(readFileSync(join(dir, "UPSTREAM.md"), "utf8")).sha).toBe(sha1);
  });
});
