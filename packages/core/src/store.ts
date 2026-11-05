import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { StatementSync } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";
import type { Decision, Item, MessageRef, Rule } from "@agentherd/protocol";
import { redact } from "@agentherd/rules";
import {
  type AuditRow,
  type DecisionRow,
  type SessionRow,
  type StoredItem,
  toAuditRow,
  toDecisionRow,
  toRule,
  toSessionRow,
  toStoredItem,
} from "./store-rows.ts";
import {
  LATEST_SCHEMA_VERSION,
  SCHEMA_SQL,
  STATE_TABLE_SQL,
  TRANSCRIPT_TABLE_SQL,
} from "./store-schema.ts";

export type { AuditRow, DecisionRow, SessionRow, StoredItem } from "./store-rows.ts";

/** One line of a task's conversation. */
export interface TranscriptEntry {
  id: number;
  at: string;
  /** prompt: what AgentHerd sent the agent; agent: its reply; tool: a tool call; note: an event. */
  role: "prompt" | "agent" | "tool" | "note";
  text: string;
  /** Tool calls only: pending, in_progress, completed or failed. */
  status?: string;
}

/** Entries kept per task; older ones are dropped. */
export const TRANSCRIPT_MAX_ENTRIES = 2000;
/** Characters kept per entry. */
export const TRANSCRIPT_MAX_CHARS = 20_000;

export interface StoreOptions {
  secrets?: Record<string, string>;
}

export class Store {
  private readonly db: DatabaseSync;
  private readonly secrets: Record<string, string> | undefined;

  private readonly stmtUpsertSession: StatementSync;
  private readonly stmtGetSession: StatementSync;
  private readonly stmtInsertItem: StatementSync;
  private readonly stmtGetItem: StatementSync;
  private readonly stmtOpenItems: StatementSync;
  private readonly stmtInsertDecision: StatementSync;
  private readonly stmtDecisionsFor: StatementSync;
  private readonly stmtInsertRule: StatementSync;
  private readonly stmtListRules: StatementSync;
  private readonly stmtDeleteRule: StatementSync;
  private readonly stmtInsertAudit: StatementSync;
  private readonly stmtAuditRows: StatementSync;
  private readonly stmtAuditRowsByKind: StatementSync;
  private readonly stmtGetState: StatementSync;
  private readonly stmtSetState: StatementSync;
  private readonly stmtDeleteState: StatementSync;

  private constructor(path: string, options?: StoreOptions) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(path);
    this.secrets = options?.secrets;

    this.db.exec("CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL)");
    const versionRow = this.db.prepare("SELECT version FROM schema_version LIMIT 1").get();
    if (versionRow === undefined) {
      this.db.exec(SCHEMA_SQL);
      this.db.prepare("INSERT INTO schema_version(version) VALUES (?)").run(LATEST_SCHEMA_VERSION);
    } else {
      const version = versionRow.version as number;
      if (version < 1 || version > LATEST_SCHEMA_VERSION) {
        this.db.close();
        throw new Error(`unsupported herd.db schema version ${version}`);
      }
      if (version < 2) {
        this.db.exec(STATE_TABLE_SQL);
        this.db.prepare("UPDATE schema_version SET version = ?").run(2);
      }
      if (version < 3) {
        this.db.exec(TRANSCRIPT_TABLE_SQL);
        this.db.prepare("UPDATE schema_version SET version = ?").run(3);
      }
    }

    if (path !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL");
    }

    this.stmtUpsertSession = this.db.prepare(
      "INSERT OR REPLACE INTO sessions(id, profile_id, cwd, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    this.stmtGetSession = this.db.prepare(
      "SELECT id, profile_id, cwd, state, created_at, updated_at FROM sessions WHERE id = ?",
    );
    this.stmtInsertItem = this.db.prepare(
      "INSERT INTO items(id, session_id, profile_id, cwd, kind, state, tool_call_json, title, body, risk, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.stmtGetItem = this.db.prepare(
      "SELECT id, session_id, profile_id, cwd, kind, state, tool_call_json, title, body, risk, created_at, decided_at, message_ref_json FROM items WHERE id = ?",
    );
    this.stmtOpenItems = this.db.prepare(
      "SELECT id, session_id, profile_id, cwd, kind, state, tool_call_json, title, body, risk, created_at, decided_at, message_ref_json FROM items WHERE state = 'open' ORDER BY created_at, rowid",
    );
    this.stmtInsertDecision = this.db.prepare(
      "INSERT INTO decisions(item_id, action, text, source, reason, confidence, risk, rule_id, owner_id, precedents_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.stmtDecisionsFor = this.db.prepare(
      "SELECT item_id, action, text, source, reason, confidence, risk, rule_id, owner_id, precedents_json, created_at FROM decisions WHERE item_id = ? ORDER BY rowid",
    );
    this.stmtInsertRule = this.db.prepare(
      "INSERT INTO rules(id, action, match_json, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    this.stmtListRules = this.db.prepare(
      "SELECT id, action, match_json, created_by, created_at FROM rules ORDER BY rowid",
    );
    this.stmtDeleteRule = this.db.prepare("DELETE FROM rules WHERE id = ?");
    this.stmtInsertAudit = this.db.prepare(
      "INSERT INTO audit(at, kind, data_json) VALUES (?, ?, ?)",
    );
    this.stmtAuditRows = this.db.prepare("SELECT id, at, kind, data_json FROM audit ORDER BY id");
    this.stmtAuditRowsByKind = this.db.prepare(
      "SELECT id, at, kind, data_json FROM audit WHERE kind = ? ORDER BY id",
    );
    this.stmtGetState = this.db.prepare("SELECT value_json FROM state WHERE key = ?");
    this.stmtSetState = this.db.prepare(
      "INSERT OR REPLACE INTO state(key, value_json, updated_at) VALUES (?, ?, ?)",
    );
    this.stmtDeleteState = this.db.prepare("DELETE FROM state WHERE key = ?");
  }

  static open(path: string, options?: StoreOptions): Store {
    return new Store(path, options);
  }

  close(): void {
    if (this.db.isOpen) {
      this.db.close();
    }
  }

  upsertSession(row: SessionRow): void {
    this.stmtUpsertSession.run(
      row.id,
      row.profileId,
      row.cwd,
      row.state,
      row.createdAt,
      row.updatedAt,
    );
  }

  getSession(id: string): SessionRow | undefined {
    const row = this.stmtGetSession.get(id);
    return row === undefined ? undefined : toSessionRow(row);
  }

  insertItem(item: Item): void {
    this.stmtInsertItem.run(
      item.id,
      item.sessionId,
      item.profileId,
      item.cwd,
      item.kind,
      item.state,
      item.toolCall === undefined ? null : redact(JSON.stringify(item.toolCall), this.secrets),
      redact(item.title, this.secrets),
      redact(item.body, this.secrets),
      item.risk,
      item.createdAt,
    );
  }

  updateItem(
    id: string,
    patch: {
      state?: Item["state"];
      decidedAt?: string;
      messageRef?: MessageRef;
      risk?: Item["risk"];
    },
  ): void {
    const sets: string[] = [];
    const args: string[] = [];
    if (patch.state !== undefined) {
      sets.push("state = ?");
      args.push(patch.state);
    }
    if (patch.decidedAt !== undefined) {
      sets.push("decided_at = ?");
      args.push(patch.decidedAt);
    }
    if (patch.messageRef !== undefined) {
      sets.push("message_ref_json = ?");
      args.push(JSON.stringify(patch.messageRef));
    }
    if (patch.risk !== undefined) {
      sets.push("risk = ?");
      args.push(patch.risk);
    }
    if (sets.length === 0) {
      return;
    }
    args.push(id);
    this.db.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  }

  getItem(id: string): StoredItem | undefined {
    const row = this.stmtGetItem.get(id);
    return row === undefined ? undefined : toStoredItem(row);
  }

  openItems(): StoredItem[] {
    return this.stmtOpenItems.all().map(toStoredItem);
  }

  insertDecision(
    decision: Decision,
    extra: { ruleId?: string; ownerId?: string; createdAt: string },
  ): void {
    this.stmtInsertDecision.run(
      decision.itemId,
      decision.action,
      decision.text === undefined ? null : redact(decision.text, this.secrets),
      decision.source,
      redact(decision.reason, this.secrets),
      decision.confidence,
      decision.risk,
      extra.ruleId ?? null,
      extra.ownerId ?? null,
      JSON.stringify(decision.precedents),
      extra.createdAt,
    );
  }

  decisionsFor(itemId: string): DecisionRow[] {
    return this.stmtDecisionsFor.all(itemId).map(toDecisionRow);
  }

  /** Newest first. */
  recentSessions(limit = 20): SessionRow[] {
    return this.db
      .prepare("SELECT * FROM sessions ORDER BY updated_at DESC, rowid DESC LIMIT ?")
      .all(limit)
      .map(toSessionRow);
  }

  /** Newest first. */
  recentDecisions(limit = 20): DecisionRow[] {
    return this.db
      .prepare("SELECT * FROM decisions ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(limit)
      .map(toDecisionRow);
  }

  insertRule(rule: Rule): void {
    this.stmtInsertRule.run(
      rule.id,
      rule.action,
      JSON.stringify(rule.match),
      rule.createdBy,
      rule.createdAt,
    );
  }

  listRules(): Rule[] {
    return this.stmtListRules.all().map(toRule);
  }

  deleteRule(id: string): boolean {
    const result = this.stmtDeleteRule.run(id);
    return Number(result.changes) > 0;
  }

  audit(kind: string, data: Record<string, unknown>, at?: string): void {
    this.stmtInsertAudit.run(
      at ?? new Date().toISOString(),
      kind,
      redact(JSON.stringify(data), this.secrets),
    );
  }

  auditRows(kind?: string): AuditRow[] {
    const rows = kind === undefined ? this.stmtAuditRows.all() : this.stmtAuditRowsByKind.all(kind);
    return rows.map(toAuditRow);
  }

  /** Adds a line to a task's conversation (secrets redacted). */
  addTranscript(
    taskId: string,
    role: TranscriptEntry["role"],
    text: string,
    tool?: { id: string; status?: string },
  ): void {
    const cut =
      text.length > TRANSCRIPT_MAX_CHARS ? `${text.slice(0, TRANSCRIPT_MAX_CHARS)}…` : text;
    this.db
      .prepare(
        "INSERT INTO transcript(task_id, at, role, text, tool_call_id, status) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        taskId,
        new Date().toISOString(),
        role,
        redact(cut, this.secrets),
        tool?.id ?? null,
        tool?.status ?? null,
      );
  }

  /** Sets the status of a tool call already in the conversation. */
  setToolStatus(taskId: string, toolCallId: string, status: string): void {
    this.db
      .prepare("UPDATE transcript SET status = ? WHERE task_id = ? AND tool_call_id = ?")
      .run(status, taskId, toolCallId);
  }

  /** The last {@link TRANSCRIPT_MAX_ENTRIES} lines of a task's conversation, oldest first. */
  transcript(taskId: string): TranscriptEntry[] {
    const rows = this.db
      .prepare(
        "SELECT id, at, role, text, status FROM transcript WHERE task_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(taskId, TRANSCRIPT_MAX_ENTRIES);
    return rows.reverse().map((r) => {
      const e: TranscriptEntry = {
        id: Number(r.id),
        at: String(r.at),
        role: r.role as TranscriptEntry["role"],
        text: String(r.text),
      };
      if (typeof r.status === "string") e.status = r.status;
      return e;
    });
  }

  getState<T>(key: string): T | undefined {
    const row = this.stmtGetState.get(key);
    return row === undefined ? undefined : (JSON.parse(row.value_json as string) as T);
  }

  setState(key: string, value: unknown, at?: Date): void {
    this.stmtSetState.run(key, JSON.stringify(value), (at ?? new Date()).toISOString());
  }

  deleteState(key: string): void {
    this.stmtDeleteState.run(key);
  }
}
