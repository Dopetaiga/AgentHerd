// Live sessions and their state (docs/spec/03-agents.md "Session states"). Every change is
// stored and emitted.

import type { SessionState } from "@agentherd/protocol";
import type { Clock } from "./clock.ts";
import type { SessionRow, Store } from "./store.ts";

export type SessionListener = (row: SessionRow, previous: SessionState | null) => void;

export class Registry {
  private readonly sessions = new Map<string, SessionRow>();
  private readonly listeners = new Set<SessionListener>();

  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  add(id: string, profileId: string, cwd: string): SessionRow {
    const now = this.clock.now().toISOString();
    const row: SessionRow = {
      id,
      profileId,
      cwd,
      state: "starting",
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, row);
    this.store.upsertSession(row);
    for (const l of this.listeners) l(row, null);
    return row;
  }

  set(id: string, state: SessionState): void {
    const row = this.sessions.get(id);
    if (row === undefined || row.state === state) return;
    // `ended` is final.
    if (row.state === "ended") return;
    const previous = row.state;
    row.state = state;
    row.updatedAt = this.clock.now().toISOString();
    this.store.upsertSession(row);
    for (const l of this.listeners) l({ ...row }, previous);
  }

  get(id: string): SessionRow | undefined {
    const row = this.sessions.get(id);
    return row === undefined ? undefined : { ...row };
  }

  list(): SessionRow[] {
    return [...this.sessions.values()].map((r) => ({ ...r }));
  }

  onChange(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
