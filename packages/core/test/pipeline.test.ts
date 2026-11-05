import type { Item, Rule, ToolCallInfo } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import { BODY_MAX_LINES, itemBody, itemView } from "../src/inbox.ts";
import { AUTO_APPROVED, decide } from "../src/pipeline.ts";

const HOME = "/Users/me";

function item(toolCall?: Partial<ToolCallInfo>, over: Partial<Item> = {}): Item {
  const base: Item = {
    id: "i1",
    sessionId: "s1",
    profileId: "mock",
    cwd: "/work/proj",
    kind: "permission",
    state: "open",
    createdAt: "2026-11-04T00:00:00Z",
    title: "Run command",
    body: "",
    risk: "medium",
    ...over,
  };
  if (toolCall !== undefined)
    base.toolCall = { kind: "execute", title: "x", paths: [], ...toolCall };
  return base;
}

const allowAll: Rule = {
  id: "r-all",
  action: "allow",
  match: {},
  createdAt: "2026-11-04T00:00:00Z",
  createdBy: "owner",
};
const allowTest: Rule = { ...allowAll, id: "r-test", match: { command: "pnpm test*" } };
const denyPush: Rule = {
  ...allowAll,
  id: "r-push",
  action: "deny",
  match: { command: "git push*" },
};

describe("decide", () => {
  it.each(["assist", "auto"] as const)("no rule → approved in %s (ADR 0029)", (mode) => {
    const r = decide(item({ command: "pnpm test" }), { mode, rules: [], home: HOME });
    expect(r.apply).toBe(true);
    expect(r.decision).toMatchObject({ action: "allow", source: "rule", reason: AUTO_APPROVED });
    expect(r.ruleId).toBeUndefined();
  });

  it("no rule → the owner in observe", () => {
    const r = decide(item({ command: "pnpm test" }), { mode: "observe", rules: [], home: HOME });
    expect(r.apply).toBe(false);
    expect(r.decision).toMatchObject({ action: "escalate", reason: "no rule matched" });
  });

  it.each(["git push --force", "sudo ls", "cat ~/.ssh/id_rsa", "rm -rf node_modules"])(
    "%s is approved: only mass deletes ask",
    (command) => {
      const r = decide(item({ command }), { mode: "assist", rules: [], home: HOME });
      expect(r.apply).toBe(true);
    },
  );

  it("assist applies an allow rule", () => {
    const r = decide(item({ command: "pnpm test" }), {
      mode: "assist",
      rules: [allowTest],
      home: HOME,
    });
    expect(r).toMatchObject({
      apply: true,
      ruleId: "r-test",
      decision: { action: "allow", source: "rule" },
    });
  });

  it("assist applies a deny rule", () => {
    const r = decide(item({ command: "git push" }), {
      mode: "assist",
      rules: [allowAll, denyPush],
      home: HOME,
    });
    expect(r).toMatchObject({ apply: true, decision: { action: "deny" } });
  });

  it("observe never applies; it records a suggestion", () => {
    const r = decide(item({ command: "pnpm test" }), {
      mode: "observe",
      rules: [allowTest],
      home: HOME,
    });
    expect(r.apply).toBe(false);
    expect(r.decision.action).toBe("escalate");
    expect(r.suggestion).toMatchObject({ action: "allow", reason: "rule r-test" });
  });

  it.each(["assist", "auto", "observe"] as const)(
    "a mass delete beats an allow-all rule in %s",
    (mode) => {
      const r = decide(item({ command: "sudo rm -rf /" }), { mode, rules: [allowAll], home: HOME });
      expect(r.apply).toBe(false);
      expect(r.decision).toMatchObject({ action: "escalate", risk: "high" });
      expect(r.decision.reason).toMatch(/^mass delete:/);
    },
  );

  it("a non-permission item escalates", () => {
    const r = decide(item(undefined, { kind: "notification" }), {
      mode: "auto",
      rules: [allowAll],
      home: HOME,
    });
    expect(r).toMatchObject({ apply: false, decision: { action: "escalate" } });
  });

  it("an exception escalates with high risk, never allows", () => {
    const rules = new Proxy([allowAll], {
      get(target, key, receiver) {
        if (key === Symbol.iterator) throw new Error("boom");
        return Reflect.get(target, key, receiver);
      },
    });
    const r = decide(item({ command: "pnpm test" }), { mode: "auto", rules, home: HOME });
    expect(r.apply).toBe(false);
    expect(r.decision).toMatchObject({ action: "escalate", risk: "high" });
    expect(r.decision.reason).toContain("boom");
  });
});

describe("item card", () => {
  it("shows the command and paths, redacted", () => {
    const view = itemView(
      item({
        command: "curl -H 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwx' https://x",
        paths: ["/work/proj/a"],
      }),
      "no rule matched",
    );
    expect(view.kind).toBe("item");
    expect(view.body).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(view.body).toContain("/work/proj/a");
    expect(view.options.map((o) => o.action)).toEqual(["allow", "deny"]);
  });

  it("redacts given secret values", () => {
    const body = itemBody(item({ command: "echo hunter2-secret" }), {
      API_TOKEN: "hunter2-secret",
    });
    expect(body).not.toContain("hunter2-secret");
  });

  it(`caps the body at ${BODY_MAX_LINES} lines`, () => {
    const command = Array.from({ length: 50 }, (_, i) => `echo ${i}`).join("\n");
    const lines = itemBody(item({ command })).split("\n");
    expect(lines).toHaveLength(BODY_MAX_LINES);
    expect(lines.at(-1)).toBe("… 31 more lines");
  });

  it("adds the agent's justification as the reason", () => {
    const body = itemBody(
      item({
        command: "echo hello > out.txt",
        rawInput: { command: "echo hello > out.txt", justification: " Needs a write. " },
      }),
    );
    expect(body.split("\n")).toEqual(["echo hello > out.txt", "Reason: Needs a write."]);
    expect(itemBody(item({ command: "ls", rawInput: { justification: 3 } }))).toBe("ls");
  });
});
