import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SQLOutputValue, StatementSync } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";
import type {
  Decision,
  Item,
  MessageRef,
  Risk,
  Rule,
  RuleMatch,
  SessionState,
  ToolCallInfo,
} from "@agentherd/protocol";
import { redact } from "@agentherd/rules";

export interface SessionRow {
  id: string;
  profileId: string;
  cwd: string;
  state: SessionState;
  createdAt: string;
  updatedAt: string;
}

export interface StoredItem extends Item {
  decidedAt?: string;
  messageRef?: MessageRef;
}

export interface DecisionRow extends Decision {
  ruleId?: string;
  ownerId?: string;
  createdAt: string;
}

export interface AuditRow {
  id: number;
  at: string;
  kind: string;
  data: Record<string, unknown>;
}

export interface StoreOptions {
  secrets?: Record<string, string>;
}

// Added in schema version 2 so databases created before plan 008 get the table too.
const STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS state(
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

const LATEST_SCHEMA_VERSION = 2;

const SCHEMA_SQL = `
CREATE TABLE sessions(
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE items(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  tool_call_json TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  risk TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  message_ref_json TEXT
);
CREATE TABLE decisions(
  item_id TEXT NOT NULL,
  action TEXT NOT NULL,
  text TEXT,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence REAL NOT NULL,
  risk TEXT NOT NULL,
  rule_id TEXT,
  owner_id TEXT,
  precedents_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE rules(
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  match_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  data_json TEXT NOT NULL
);
${STATE_TABLE_SQL}
`;

function toSessionRow(row: Record<string, SQLOutputValue>): SessionRow {
  return {
    id: row.id as string,
    profileId: row.profile_id as string,
    cwd: row.cwd as string,
    state: row.state as SessionState,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toStoredItem(row: Record<string, SQLOutputValue>): StoredItem {
  const item: StoredItem = {
    id: row.id as string,
    sessionId: row.session_id as string,
    profileId: row.profile_id as string,
    cwd: row.cwd as string,
    kind: row.kind as Item["kind"],
    state: row.state as Item["state"],
    createdAt: row.created_at as string,
    title: row.title as string,
    body: row.body as string,
    risk: row.risk as Risk,
  };
  if (row.tool_call_json !== null) {
    item.toolCall = JSON.parse(row.tool_call_json as string) as ToolCallInfo;
  }
  if (row.decided_at !== null) {
    item.decidedAt = row.decided_at as string;
  }
  if (row.message_ref_json !== null) {
    item.messageRef = JSON.parse(row.message_ref_json as string) as MessageRef;
  }
  return item;
}

function toDecisionRow(row: Record<string, SQLOutputValue>): DecisionRow {
  const decision: DecisionRow = {
    itemId: row.item_id as string,
    action: row.action as Decision["action"],
    confidence: row.confidence as number,
    risk: row.risk as Risk,
    source: row.source as Decision["source"],
    reason: row.reason as string,
    precedents: JSON.parse(row.precedents_json as string) as string[],
    createdAt: row.created_at as string,
  };
  if (row.text !== null) {
    decision.text = row.text as string;
  }
  if (row.rule_id !== null) {
    decision.ruleId = row.rule_id as string;
  }
  if (row.owner_id !== null) {
    decision.ownerId = row.owner_id as string;
  }
  return decision;
}

function toRule(row: Record<string, SQLOutputValue>): Rule {
  return {
    id: row.id as string,
    action: row.action as Rule["action"],
    match: JSON.parse(row.match_json as string) as RuleMatch,
    createdAt: row.created_at as string,
    createdBy: row.created_by as Rule["createdBy"],
  };
}

function toAuditRow(row: Record<string, SQLOutputValue>): AuditRow {
  return {
    id: row.id as number,
    at: row.at as string,
    kind: row.kind as string,
    data: JSON.parse(row.data_json as string) as Record<string, unknown>,
  };
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
