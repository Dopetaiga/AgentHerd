import { mkdirSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFindCache,
  findProjects,
  foundText,
  listRepos,
  nameKey,
} from "../src/project-find.ts";
import { pathsIn } from "../src/tools.ts";

function repo(root: string, path: string, ageSeconds = 0): string {
  const dir = join(root, path);
  mkdirSync(join(dir, ".git"), { recursive: true });
  const t = Date.now() / 1000 - ageSeconds;
  utimesSync(join(dir, ".git"), t, t);
  return dir;
}

describe("project_find", () => {
  let root: string;
  beforeEach(() => {
    clearFindCache();
    root = mkdtempSync(join(tmpdir(), "agentherd-find-"));
  });

  it("ignores case, - and _ in names", () => {
    expect(nameKey("PI-Desktop")).toBe(nameKey("pi_desktop"));
  });

  it("finds exact matches newest first and skips Library, node_modules and hidden folders", () => {
    const old = repo(root, "work/pi-desktop", 1000);
    const fresh = repo(root, "learn-agent/PI_Desktop", 10);
    repo(root, "Library/pi-desktop");
    repo(root, "x/node_modules/pi-desktop");
    repo(root, ".cache/pi-desktop");
    repo(root, "learn-agent/PI_Desktop/packages/inner"); // inside a repo: not a project
    expect(findProjects(root, "pi-desktop", listRepos(root))).toEqual({
      exact: [fresh, old],
      similar: [],
    });
  });

  it("offers similar names when nothing matches exactly, and nothing when nothing is close", () => {
    const a = repo(root, "a/pi-desktop-v2");
    repo(root, "b/agentrecall");
    const found = findProjects(root, "pi-desktop", listRepos(root));
    expect(found).toEqual({ exact: [], similar: [a] });
    expect(foundText("pi-desktop", found)).toContain("Similar names");
    const none = findProjects(root, "zzzz", listRepos(root));
    expect(none).toEqual({ exact: [], similar: [] });
    expect(foundText("zzzz", none)).toContain("没找到叫 zzzz 的项目");
  });

  it("shows the 3 most recently changed when there are more", () => {
    for (let i = 0; i < 5; i++) repo(root, `p${i}/app`, i * 100);
    const found = findProjects(root, "app", listRepos(root));
    const text = foundText("app", found);
    expect(text).toContain("5 found");
    expect(text).toContain(join(root, "p0/app"));
    expect(text).not.toContain(join(root, "p4/app"));
  });
});

describe("pathsIn", () => {
  it("takes absolute and ~/ paths from the owner's words", () => {
    expect(pathsIn("在 ~/learn-agent/pi-desktop 里看看，还有 /tmp/x。", "/Users/me")).toEqual([
      "/Users/me/learn-agent/pi-desktop",
      "/tmp/x",
    ]);
    expect(pathsIn("看看 pi-desktop 的 issue", "/Users/me")).toEqual([]);
  });
});
