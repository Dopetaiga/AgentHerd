// The core facade (docs/spec/02-architecture.md §1). It receives a Channel; it imports no
// channel package and no Electron.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { type AgentConnection, type PermissionRequest, startAgent } from "@agentherd/acp-client";
import type {
  AgentProfile,
  Channel,
  ChannelBinding,
  Inbound,
  Item,
  Mode,
  Rule,
} from "@agentherd/protocol";
import type { ExtraGuard } from "@agentherd/rules";
import { type Clock, systemClock } from "./clock.ts";
import { Inbox } from "./inbox.ts";
import { decide } from "./pipeline.ts";
import { Registry } from "./registry.ts";
import { Store } from "./store.ts";

export interface HerdOptions {
  /** AgentHerd home (`AGENTHERD_HOME` or `~/.agentherd`). `herd.db` lives here. */
  home: string;
  /** The user's home directory, for `~` in commands and rules. */
  userHome: string;
  channel: Channel;
  binding: ChannelBinding;
  mode: Mode;
  profiles: AgentProfile[];
  clock?: Clock;
  remindMinutes?: number;
  extraGuards?: ExtraGuard[];
  /** Values to redact everywhere (secrets from env). */
  secrets?: Record<string, string>;
  /** Use this store instead of `<home>/herd.db` (tests pass `:memory:`). */
  store?: Store;
}

export interface RunResult {
  sessionId: string;
  stopReason: string;
}

export class Herd {
  readonly store: Store;
  readonly registry: Registry;
  private readonly inbox: Inbox;
  private readonly clock: Clock;
  private readonly connections = new Set<AgentConnection>();
  private started = false;

  private readonly opts: HerdOptions;

  constructor(opts: HerdOptions) {
    this.opts = opts;
    this.clock = opts.clock ?? systemClock;
    const storeOptions = opts.secrets === undefined ? {} : { secrets: opts.secrets };
    this.store = opts.store ?? Store.open(join(opts.home, "herd.db"), storeOptions);
    this.registry = new Registry(this.store, this.clock);
    const inboxOptions = {
      channel: opts.channel,
      binding: opts.binding,
      store: this.store,
      clock: this.clock,
      ...(opts.remindMinutes === undefined ? {} : { remindMinutes: opts.remindMinutes }),
      ...(opts.secrets === undefined ? {} : { secrets: opts.secrets }),
    };
    this.inbox = new Inbox(inboxOptions);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.opts.channel.start(this.opts.binding, (inbound) => this.handle(inbound));
    this.store.audit("herd.started", { mode: this.opts.mode, channel: this.opts.channel.id });
  }

  /** Inbound from the channel. Errors are recorded, never thrown back into the channel. */
  async handle(inbound: Inbound): Promise<void> {
    try {
      await this.inbox.handle(inbound);
    } catch (error) {
      this.store.audit("inbound.error", { message: (error as Error).message });
    }
  }

  addRule(rule: Rule): void {
    this.store.insertRule(rule);
  }

  /** Starts an agent, runs one prompt to the end of the turn, then closes the agent. */
  async run(profileId: string, cwd: string, prompt: string): Promise<RunResult> {
    const profile = this.opts.profiles.find((p) => p.id === profileId);
    if (profile === undefined) throw new Error(`unknown agent profile "${profileId}"`);
    const connection = await startAgent(profile, { cwd });
    this.connections.add(connection);
    const agentSessionId = await connection.newSession(cwd);
    const sessionId = randomUUID();
    this.registry.add(sessionId, profile.id, cwd);
    this.store.audit("session.started", { sessionId, profileId, cwd, agentSessionId });

    const offs = [
      connection.on("permission", (request) => {
        if (request.sessionId !== agentSessionId) return;
        void this.onPermission(sessionId, profile, cwd, request).catch((error: Error) => {
          // Never leave the agent without an answer it can act on: cancel, never allow.
          request.respond({ kind: "cancelled" });
          this.store.audit("permission.error", { sessionId, message: error.message });
        });
      }),
      connection.on("update", (u) => {
        if (u.sessionId !== agentSessionId) return;
        const state = this.registry.get(sessionId)?.state;
        if (state !== "waiting-approval") this.registry.set(sessionId, "working");
      }),
      connection.on("exit", (e) => {
        this.registry.set(sessionId, e.code === 0 ? "ended" : "error");
        this.store.audit("session.exited", { sessionId, code: e.code, signal: e.signal });
      }),
    ];

    try {
      this.registry.set(sessionId, "working");
      const { stopReason } = await connection.prompt(agentSessionId, prompt);
      this.registry.set(sessionId, "idle");
      this.store.audit("turn.ended", { sessionId, stopReason });
      return { sessionId, stopReason };
    } finally {
      await this.inbox.expireSession(sessionId, "the agent's turn ended");
      for (const off of offs) off();
      await connection.close();
      this.connections.delete(connection);
      this.registry.set(sessionId, "ended");
    }
  }

  private async onPermission(
    sessionId: string,
    profile: AgentProfile,
    cwd: string,
    request: PermissionRequest,
  ): Promise<void> {
    const item: Item = {
      id: randomUUID(),
      sessionId,
      profileId: profile.id,
      cwd,
      kind: "permission",
      state: "open",
      createdAt: this.clock.now().toISOString(),
      toolCall: request.toolCall,
      title: request.toolCall.title,
      body: request.toolCall.command ?? request.toolCall.paths.join("\n"),
      risk: "medium",
    };
    const result = decide(item, {
      mode: this.opts.mode,
      rules: this.store.listRules(),
      home: this.opts.userHome,
      ...(this.opts.extraGuards === undefined ? {} : { extraGuards: this.opts.extraGuards }),
    });
    item.risk = result.decision.risk;
    this.store.insertItem(item);
    if (result.suggestion !== undefined) {
      const { action, reason, confidence } = result.suggestion;
      this.store.audit("item.suggestion", { itemId: item.id, action, reason, confidence });
    }

    const now = () => this.clock.now().toISOString();
    if (result.apply) {
      const action = result.decision.action;
      const answered =
        (action === "allow" || action === "deny") && request.respond({ kind: action });
      if (answered) {
        this.store.insertDecision(result.decision, {
          ...(result.ruleId === undefined ? {} : { ruleId: result.ruleId }),
          createdAt: now(),
        });
        this.store.updateItem(item.id, { state: "decided", decidedAt: now() });
        this.store.audit("item.decided", { itemId: item.id, source: "rule", action });
      } else {
        this.store.updateItem(item.id, { state: "expired", decidedAt: now() });
      }
      return;
    }

    this.registry.set(sessionId, "waiting-approval");
    await this.inbox.add(
      item,
      {
        answer: (answer) => {
          const ok = request.respond({ kind: answer });
          if (ok) this.registry.set(sessionId, "working");
          return ok;
        },
      },
      result.decision.reason,
    );
  }

  async stop(): Promise<void> {
    await this.inbox.stop();
    await Promise.all([...this.connections].map((c) => c.close()));
    this.connections.clear();
    if (this.started) await this.opts.channel.stop();
    this.store.audit("herd.stopped", {});
    if (this.opts.store === undefined) this.store.close();
  }
}
