// Row types and the mapping from SQLite rows to them.

import type { SQLOutputValue } from "node:sqlite";
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

export function toSessionRow(row: Record<string, SQLOutputValue>): SessionRow {
  return {
    id: row.id as string,
    profileId: row.profile_id as string,
    cwd: row.cwd as string,
    state: row.state as SessionState,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function toStoredItem(row: Record<string, SQLOutputValue>): StoredItem {
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

export function toDecisionRow(row: Record<string, SQLOutputValue>): DecisionRow {
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

export function toRule(row: Record<string, SQLOutputValue>): Rule {
  return {
    id: row.id as string,
    action: row.action as Rule["action"],
    match: JSON.parse(row.match_json as string) as RuleMatch,
    createdAt: row.created_at as string,
    createdBy: row.created_by as Rule["createdBy"],
  };
}

export function toAuditRow(row: Record<string, SQLOutputValue>): AuditRow {
  return {
    id: row.id as number,
    at: row.at as string,
    kind: row.kind as string,
    data: JSON.parse(row.data_json as string) as Record<string, unknown>,
  };
}
