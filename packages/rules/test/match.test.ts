import type { Item, Rule, RuleMatch, ToolCallInfo } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import { globMatch } from "../src/glob.ts";
import { matchRules } from "../src/match.ts";

const HOME = "/Users/me";

function item(toolCall?: Partial<ToolCallInfo>, over: Partial<Item> = {}): Item {
  const base: Item = {
    id: "i1",
    sessionId: "s1",
    profileId: "dsh",
    cwd: "/work/proj",
    kind: "permission",
    state: "open",
    createdAt: "2026-11-04T00:00:00Z",
    title: "t",
    body: "b",
    risk: "low",
    ...over,
  };
  if (toolCall !== undefined) {
    base.toolCall = { kind: "execute", title: "x", paths: [], ...toolCall };
  }
  return base;
}

let n = 0;
function rule(action: Rule["action"], match: RuleMatch): Rule {
  n += 1;
  return { id: `r${n}`, action, match, createdAt: "2026-11-04T00:00:00Z", createdBy: "owner" };
}

describe("globMatch", () => {
  it.each([
    ["pnpm test", "pnpm test", true],
    ["pnpm test*", "pnpm test --run", true],
    ["pnpm test*", "pnpm tes", false],
    ["*", "", true],
    ["a*b*c", "abc", true],
    ["a*b*c", "axxbyyc", true],
    ["a*b*c", "acb", false],
    ["ab*ba", "aba", false],
    ["git *", "git", false],
    ["x.y", "xzy", false],
  ] as const)("%s ~ %s = %s", (p, t, want) => {
    expect(globMatch(p, t)).toBe(want);
  });
});

describe("matchRules fields", () => {
  it("matches every field it sets", () => {
    const r = rule("allow", {
      profileId: "dsh",
      eventType: "permission",
      toolKind: "execute",
      command: "pnpm test*",
      pathScope: { kind: "cwd" },
    });
    expect(matchRules([r], item({ command: "pnpm test --run" }), HOME)?.rule.id).toBe(r.id);
  });

  it("profileId", () => {
    const r = rule("allow", { profileId: "codex" });
    expect(matchRules([r], item({ command: "ls" }), HOME)).toBeNull();
  });

  it("eventType", () => {
    const r = rule("allow", { eventType: "permission" });
    expect(matchRules([r], item({ command: "ls" }, { kind: "notification" }), HOME)).toBeNull();
  });

  it("toolKind", () => {
    const r = rule("allow", { toolKind: "edit" });
    expect(matchRules([r], item({ command: "ls" }), HOME)).toBeNull();
    expect(matchRules([r], item({ kind: "edit", paths: ["/work/proj/a"] }), HOME)?.action).toBe(
      "allow",
    );
  });

  it("command uses the normalized command", () => {
    const r = rule("allow", { command: "pnpm test" });
    expect(matchRules([r], item({ command: "  CI=1   pnpm   test " }), HOME)?.action).toBe("allow");
  });

  it("command rule does not match an item without a command", () => {
    const r = rule("allow", { command: "*" });
    expect(matchRules([r], item({ kind: "read", paths: ["/work/proj/a"] }), HOME)).toBeNull();
  });

  it("an item with no toolCall matches only field-free rules", () => {
    expect(matchRules([rule("allow", { toolKind: "execute" })], item(), HOME)).toBeNull();
    expect(matchRules([rule("allow", { command: "*" })], item(), HOME)).toBeNull();
    expect(matchRules([rule("allow", { profileId: "dsh" })], item(), HOME)?.action).toBe("allow");
  });
});

describe("deny wins", () => {
  it("deny over allow regardless of order", () => {
    const a = rule("allow", { command: "git *" });
    const d = rule("deny", { command: "git push*" });
    expect(matchRules([a, d], item({ command: "git push" }), HOME)).toEqual({
      rule: d,
      action: "deny",
    });
  });

  it("first rule wins within one action", () => {
    const a1 = rule("allow", { command: "git *" });
    const a2 = rule("allow", { command: "git status" });
    expect(matchRules([a1, a2], item({ command: "git status" }), HOME)?.rule).toBe(a1);
  });

  it("deny matches a single segment of a compound command", () => {
    const d = rule("deny", { command: "git push*" });
    expect(matchRules([d], item({ command: "pnpm test && git push" }), HOME)?.action).toBe("deny");
  });
});

describe("compound and unparsed commands", () => {
  it("an allow rule never matches a compound command", () => {
    const a = rule("allow", { command: "pnpm test*" });
    expect(matchRules([a], item({ command: "pnpm test && git push" }), HOME)).toBeNull();
    expect(matchRules([a], item({ command: "pnpm test; curl x" }), HOME)).toBeNull();
    expect(matchRules([a], item({ command: "pnpm test | tee log" }), HOME)).toBeNull();
  });

  it("an unparsed command matches no command rule", () => {
    const a = rule("allow", { command: "*" });
    const d = rule("deny", { command: "*" });
    expect(matchRules([a, d], item({ command: "echo $(whoami)" }), HOME)).toBeNull();
  });
});

describe("pathScope", () => {
  const inCwd = rule("allow", { pathScope: { kind: "cwd" } });

  it("all reported paths inside cwd", () => {
    expect(
      matchRules([inCwd], item({ kind: "edit", paths: ["src/a.ts", "/work/proj/b"] }), HOME),
    ).not.toBeNull();
  });

  it("a ../ escape does not match", () => {
    expect(matchRules([inCwd], item({ kind: "edit", paths: ["src/../../x"] }), HOME)).toBeNull();
    expect(matchRules([inCwd], item({ command: "cat ../secret.txt" }), HOME)).toBeNull();
  });

  it("a sibling directory with the same prefix does not match", () => {
    expect(matchRules([inCwd], item({ kind: "edit", paths: ["/work/proj2/a"] }), HOME)).toBeNull();
  });

  it("command paths are checked even when reported paths are inside", () => {
    expect(
      matchRules([inCwd], item({ command: "cp a.txt ~/out", paths: ["/work/proj/a.txt"] }), HOME),
    ).toBeNull();
  });

  it("a command with no path words matches", () => {
    expect(matchRules([inCwd], item({ command: "pnpm test" }), HOME)).not.toBeNull();
  });

  it("an unknown variable does not match", () => {
    expect(matchRules([inCwd], item({ command: "cat $DIR/a" }), HOME)).toBeNull();
  });

  it("dir scope with ~", () => {
    const r = rule("allow", { pathScope: { kind: "dir", path: "~/notes" } });
    expect(
      matchRules([r], item({ kind: "edit", paths: ["/Users/me/notes/a.md"] }), HOME),
    ).not.toBeNull();
    expect(matchRules([r], item({ kind: "edit", paths: ["/Users/me/other.md"] }), HOME)).toBeNull();
  });
});
