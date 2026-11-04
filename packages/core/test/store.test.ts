import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Decision, Item, Rule } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import type { SessionRow } from "../src/index.ts";
import { Store } from "../src/index.ts";

const NOW = "2026-11-04T00:00:00.000Z";
const REDACTED = "«redacted»";

function makeItem(over: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    sessionId: "session-1",
    profileId: "profile-1",
    cwd: "/work/proj",
    kind: "permission",
    state: "open",
    createdAt: NOW,
    title: "Run tests",
    body: "pnpm test",
    risk: "low",
    ...over,
  };
}

describe("Store (in-memory)", () => {
  it("round-trips sessions", () => {
    const store = Store.open(":memory:");
    const session: SessionRow = {
      id: "session-1",
      profileId: "profile-1",
      cwd: "/work/proj",
      state: "working",
      createdAt: NOW,
      updatedAt: NOW,
    };
    store.upsertSession(session);
    expect(store.getSession("session-1")).toEqual(session);
    expect(store.getSession("missing")).toBeUndefined();
  });

  it("replaces a session on upsert by id", () => {
    const store = Store.open(":memory:");
    store.upsertSession({
      id: "session-1",
      profileId: "profile-1",
      cwd: "/work/proj",
      state: "working",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const updated: SessionRow = {
      id: "session-1",
      profileId: "profile-2",
      cwd: "/other",
      state: "idle",
      createdAt: NOW,
      updatedAt: "2026-11-04T00:00:01.000Z",
    };
    store.upsertSession(updated);
    expect(store.getSession("session-1")).toEqual(updated);
  });

  it("round-trips items including toolCall", () => {
    const store = Store.open(":memory:");
    const item = makeItem({
      toolCall: { kind: "execute", title: "run", command: "pnpm test", paths: ["src"] },
    });
    store.insertItem(item);
    expect(store.getItem(item.id)).toEqual({
      id: item.id,
      sessionId: item.sessionId,
      profileId: item.profileId,
      cwd: item.cwd,
      kind: item.kind,
      state: item.state,
      createdAt: item.createdAt,
      title: item.title,
      body: item.body,
      risk: item.risk,
      toolCall: item.toolCall,
    });
  });

  it("does not store the item decision field", () => {
    const store = Store.open(":memory:");
    const decision: Decision = {
      itemId: "item-1",
      action: "allow",
      confidence: 1,
      risk: "low",
      source: "rule",
      reason: "matched",
      precedents: [],
    };
    store.insertItem(makeItem({ decision }));
    const got = store.getItem("item-1");
    expect(got).toBeDefined();
    expect("decision" in (got ?? {})).toBe(false);
  });

  it("applies a partial updateItem patch", () => {
    const store = Store.open(":memory:");
    store.insertItem(makeItem({ id: "item-1" }));

    store.updateItem("item-1", { state: "decided", decidedAt: "2026-11-04T01:00:00.000Z" });
    const first = store.getItem("item-1");
    expect(first?.state).toBe("decided");
    expect(first?.decidedAt).toBe("2026-11-04T01:00:00.000Z");
    expect(first?.risk).toBe("low");
    expect(first?.body).toBe("pnpm test");

    store.updateItem("item-1", {
      risk: "high",
      messageRef: { channelId: "ch-1", id: "msg-1" },
    });
    const second = store.getItem("item-1");
    expect(second?.risk).toBe("high");
    expect(second?.messageRef).toEqual({ channelId: "ch-1", id: "msg-1" });
    expect(second?.state).toBe("decided");
    expect(second?.decidedAt).toBe("2026-11-04T01:00:00.000Z");
  });

  it("filters openItems to state = 'open' in created_at order", () => {
    const store = Store.open(":memory:");
    store.insertItem(makeItem({ id: "open-1", createdAt: "2026-11-04T00:00:00.000Z" }));
    store.insertItem(makeItem({ id: "open-2", createdAt: "2026-11-04T00:00:02.000Z" }));
    store.insertItem(makeItem({ id: "decided-1", state: "decided" }));
    expect(store.openItems().map((i) => i.id)).toEqual(["open-1", "open-2"]);
  });

  it("round-trips decisions with optional fields", () => {
    const store = Store.open(":memory:");
    const withOptional: Decision = {
      itemId: "item-1",
      action: "allow",
      text: "go ahead",
      confidence: 0.9,
      risk: "low",
      source: "rule",
      reason: "matches allow rule",
      precedents: ["rule-1"],
    };
    store.insertDecision(withOptional, { ruleId: "rule-1", ownerId: "owner-1", createdAt: NOW });

    const withoutOptional: Decision = {
      itemId: "item-1",
      action: "deny",
      confidence: 0.5,
      risk: "high",
      source: "human",
      reason: "blocked by owner",
      precedents: [],
    };
    store.insertDecision(withoutOptional, { createdAt: "2026-11-04T00:00:01.000Z" });

    expect(store.decisionsFor("item-1")).toEqual([
      { ...withOptional, ruleId: "rule-1", ownerId: "owner-1", createdAt: NOW },
      { ...withoutOptional, createdAt: "2026-11-04T00:00:01.000Z" },
    ]);
  });

  it("round-trips rules and reports deleteRule", () => {
    const store = Store.open(":memory:");
    const rule: Rule = {
      id: "rule-1",
      action: "allow",
      match: { toolKind: "execute", command: "pnpm test*" },
      createdAt: NOW,
      createdBy: "owner",
    };
    store.insertRule(rule);
    expect(store.listRules()).toEqual([rule]);
    expect(store.deleteRule("rule-1")).toBe(true);
    expect(store.deleteRule("rule-1")).toBe(false);
    expect(store.listRules()).toEqual([]);
  });

  it("round-trips audit rows and filters by kind", () => {
    const store = Store.open(":memory:");
    store.audit("decision", { itemId: "item-1", action: "allow" }, "2026-11-04T01:00:00.000Z");
    store.audit("session", { sessionId: "session-1" }, "2026-11-04T02:00:00.000Z");
    expect(store.auditRows()).toEqual([
      {
        id: 1,
        at: "2026-11-04T01:00:00.000Z",
        kind: "decision",
        data: { itemId: "item-1", action: "allow" },
      },
      {
        id: 2,
        at: "2026-11-04T02:00:00.000Z",
        kind: "session",
        data: { sessionId: "session-1" },
      },
    ]);
    expect(store.auditRows("session")).toEqual([
      { id: 2, at: "2026-11-04T02:00:00.000Z", kind: "session", data: { sessionId: "session-1" } },
    ]);
  });

  it("redacts an env secret in item body, toolCall command, decision reason and audit data", () => {
    const secret = "sk-abcdefghijklmnop1234";
    const store = Store.open(":memory:", { secrets: { API_KEY: secret } });
    const item = makeItem({
      id: "item-secret",
      body: `body has ${secret}`,
      toolCall: { kind: "execute", title: "run", command: `run ${secret}`, paths: [] },
    });
    store.insertItem(item);
    store.insertDecision(
      {
        itemId: "item-secret",
        action: "deny",
        confidence: 1,
        risk: "high",
        source: "human",
        reason: `denied because ${secret}`,
        precedents: [],
      },
      { createdAt: NOW },
    );
    store.audit("decision", { reason: `used ${secret}` }, NOW);

    const got = store.getItem("item-secret");
    expect(got?.body).toBe(`body has ${REDACTED}`);
    expect(got?.body).not.toContain(secret);
    expect(got?.toolCall?.command).toBe(`run ${REDACTED}`);
    expect(got?.toolCall?.command).not.toContain(secret);

    const decisions = store.decisionsFor("item-secret");
    expect(decisions[0]?.reason).toBe(`denied because ${REDACTED}`);
    expect(decisions[0]?.reason).not.toContain(secret);

    const rows = store.auditRows("decision");
    expect(rows[0]?.data).toEqual({ reason: `used ${REDACTED}` });
  });
});

describe("Store (file-backed)", () => {
  it("creates the parent directory with mode 0o700 and keeps data on reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "nested", "herd.db");

    const first = Store.open(dbPath);
    const session: SessionRow = {
      id: "session-1",
      profileId: "profile-1",
      cwd: "/work/proj",
      state: "working",
      createdAt: NOW,
      updatedAt: NOW,
    };
    first.upsertSession(session);
    first.close();

    expect(statSync(join(dir, "nested")).mode & 0o777).toBe(0o700);

    const reopened = Store.open(dbPath);
    expect(reopened.getSession("session-1")).toEqual(session);
    reopened.close();
  });

  it("throws on an unsupported schema version", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");

    const first = Store.open(dbPath);
    first.close();

    const raw = new DatabaseSync(dbPath);
    raw.exec("UPDATE schema_version SET version = 3");
    raw.close();

    expect(() => Store.open(dbPath)).toThrow("unsupported herd.db schema version 3");
  });
});

describe("Store (state)", () => {
  it("round-trips a value and returns undefined for a missing key", () => {
    const store = Store.open(":memory:");
    store.setState("mode", "relay");
    expect(store.getState<string>("mode")).toBe("relay");
    expect(store.getState("missing")).toBeUndefined();
  });

  it("overwrites an existing key", () => {
    const store = Store.open(":memory:");
    store.setState("count", 1);
    store.setState("count", 2);
    expect(store.getState<number>("count")).toBe(2);
  });

  it("deletes a key", () => {
    const store = Store.open(":memory:");
    store.setState("token", "abc");
    expect(store.getState("token")).toBe("abc");
    store.deleteState("token");
    expect(store.getState("token")).toBeUndefined();
  });

  it("round-trips a structured value through JSON", () => {
    const store = Store.open(":memory:");
    const value = { taskId: "task-1", startedAt: "2026-11-04T00:00:00.000Z" };
    store.setState("relay", value);
    expect(store.getState<typeof value>("relay")).toEqual(value);
  });

  it("keeps a value across a close and reopen of the same file", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");

    const first = Store.open(dbPath);
    first.setState("relay", { taskId: "task-1", startedAt: NOW });
    first.close();

    const reopened = Store.open(dbPath);
    expect(reopened.getState<{ taskId: string; startedAt: string }>("relay")).toEqual({
      taskId: "task-1",
      startedAt: NOW,
    });
    reopened.close();
  });

  it("migrates a version-1 database to version 2 and adds the state table", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");

    const first = Store.open(dbPath);
    first.close();

    const raw = new DatabaseSync(dbPath);
    raw.exec("DROP TABLE state");
    raw.exec("UPDATE schema_version SET version = 1");
    raw.close();

    const migrated = Store.open(dbPath);
    migrated.setState("relay", { taskId: "task-1" });
    expect(migrated.getState<{ taskId: string }>("relay")).toEqual({ taskId: "task-1" });
    migrated.close();
  });
});
