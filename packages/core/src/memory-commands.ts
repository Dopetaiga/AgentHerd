// The owner's chat commands for the Herder's memory (ADR 0038): /记忆 lists or searches, /忘掉
// deletes one entry, /恢复 brings a deleted one back. They work without the Herder model.

import { MEMORY_KINDS, type MemoryRow, type MemoryStore } from "./memory-store.ts";
import type { CoreTexts } from "./texts.ts";

/** Entries shown per kind in the list, newest first. */
export const LIST_PER_KIND = 8;

/** The local day an entry was written, e.g. 2026-11-06. */
function day(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function line(r: MemoryRow): string {
  return `- ${r.id.slice(0, 8)} ${r.abstract}（${day(r.createdAt)}）`;
}

export function memoryListText(memory: MemoryStore, query: string, t: CoreTexts): string {
  if (query !== "") {
    const hits = memory.search(query, { limit: 10 });
    if (hits.length === 0) return t.memoryNoMatch(query);
    return `${hits.map((h) => `${line(h)} · ${t.memoryKinds[h.kind]}`).join("\n")}\n\n${t.memoryFooter}`;
  }
  const all = memory.list();
  if (all.length === 0) return t.memoryEmpty;
  const parts: string[] = [];
  let shown = 0;
  for (const kind of MEMORY_KINDS) {
    const rows = all.filter((r) => r.kind === kind);
    if (rows.length === 0) continue;
    const top = rows.slice(0, LIST_PER_KIND);
    shown += top.length;
    parts.push(`${t.memoryKinds[kind]}\n${top.map(line).join("\n")}`);
  }
  return `${t.memoryHeader(shown, all.length)}\n\n${parts.join("\n\n")}\n\n${t.memoryFooter}`;
}

/** Entries whose id starts with `target`, or else whose words match it. */
function find(memory: MemoryStore, target: string, deleted: boolean): MemoryRow[] {
  const pool = memory.list({ status: deleted ? "deleted" : "active" });
  const byId = pool.filter((r) => r.id.startsWith(target.toLowerCase()));
  if (byId.length > 0) return byId;
  const words = target.toLowerCase();
  return pool.filter((r) => `${r.abstract} ${r.body}`.toLowerCase().includes(words));
}

function one(
  memory: MemoryStore,
  target: string,
  deleted: boolean,
  t: CoreTexts,
): MemoryRow | string {
  const rows = find(memory, target, deleted);
  if (rows.length === 0) return t.memoryNoMatch(target);
  if (rows.length > 1) return t.memoryMany(rows.slice(0, 8).map(line).join("\n"));
  return rows[0] as MemoryRow;
}

export function forgetMemory(memory: MemoryStore, target: string, t: CoreTexts): string {
  const row = one(memory, target, false, t);
  if (typeof row === "string") return row;
  memory.setStatus(row.id, "deleted");
  memory.log("owner.forgot", row.abstract, row.id);
  return t.forgot(row.abstract);
}

export function restoreMemory(memory: MemoryStore, target: string, t: CoreTexts): string {
  const row = one(memory, target, true, t);
  if (typeof row === "string") return row;
  memory.setStatus(row.id, "active");
  memory.log("owner.restored", row.abstract, row.id);
  return t.restored(row.abstract);
}
