// Starts an agent CLI as an ACP server over stdio and exposes the small surface core needs
// (docs/spec/03-agents.md). AgentHerd is the ACP client: it offers no fs and no terminal, so
// every action of the agent goes through its own tools and asks permission through ACP.

import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  type ClientConnection,
  client,
  methods,
  ndJsonStream,
  type PermissionOption,
  PROTOCOL_VERSION,
  type SessionNotification,
  type StopReason,
} from "@agentclientprotocol/sdk";
import type { AgentProfile, ToolCallInfo } from "@agentherd/protocol";
import { redact } from "@agentherd/rules";
import { type PermissionAnswer, toAcpOutcome, toToolCallInfo } from "./mapping.ts";

export const STDERR_LINES = 200;
/** How long a failed request waits for the process exit to explain it. */
const EXIT_GRACE_MS = 1000;

export interface StartOptions {
  cwd: string;
  env?: Record<string, string>;
}

export interface SessionUpdateEvent {
  sessionId: string;
  type: "message" | "tool_call" | "tool_call_update" | "plan" | "other";
  text?: string;
  toolCallId?: string;
  toolCall?: ToolCallInfo;
  status?: string;
}

export interface PermissionRequest {
  sessionId: string;
  /** Unique within one connection. */
  requestId: string;
  toolCallId: string;
  toolCall: ToolCallInfo;
  options: { id: string; kind: string; name: string }[];
  /** Answers the agent. Only the first call counts; it returns false for later calls. */
  respond(answer: PermissionAnswer): boolean;
  readonly answered: boolean;
}

export interface ExitEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Last lines of stderr, redacted. */
  stderr: string[];
}

interface Events {
  update: SessionUpdateEvent;
  permission: PermissionRequest;
  exit: ExitEvent;
}

type Listener<T> = (event: T) => void;

export interface AgentConnection {
  readonly profile: AgentProfile;
  readonly agentName: string;
  readonly pid: number | undefined;
  newSession(cwd: string): Promise<string>;
  prompt(sessionId: string, text: string): Promise<{ stopReason: StopReason }>;
  /** Sends `session/cancel` and answers the session's open permission requests `cancelled`. */
  cancel(sessionId: string): Promise<void>;
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void;
  /** Last lines of stderr, redacted. */
  stderr(): string[];
  close(): Promise<void>;
}

function toUpdateEvent(n: SessionNotification): SessionUpdateEvent {
  const u = n.update;
  switch (u.sessionUpdate) {
    case "agent_message_chunk":
      return {
        sessionId: n.sessionId,
        type: "message",
        text: u.content.type === "text" ? u.content.text : "",
      };
    case "tool_call":
    case "tool_call_update": {
      const event: SessionUpdateEvent = {
        sessionId: n.sessionId,
        type: u.sessionUpdate,
        toolCallId: u.toolCallId,
        toolCall: toToolCallInfo(u),
      };
      if (u.status !== undefined && u.status !== null) event.status = u.status;
      return event;
    }
    case "plan":
      return { sessionId: n.sessionId, type: "plan" };
    default:
      return { sessionId: n.sessionId, type: "other" };
  }
}

class Emitter {
  private listeners = new Map<string, Set<Listener<never>>>();
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => set.delete(listener as Listener<never>);
  }
  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const l of this.listeners.get(event) ?? []) (l as Listener<Events[K]>)(value);
  }
}

class StderrRing {
  private lines: string[] = [];
  private partial = "";
  constructor(private readonly secrets: Record<string, string>) {}
  push(chunk: string): void {
    const parts = (this.partial + chunk).split("\n");
    this.partial = parts.pop() ?? "";
    for (const line of parts) this.add(line);
  }
  private add(line: string): void {
    this.lines.push(redact(line, this.secrets));
    if (this.lines.length > STDERR_LINES) this.lines.shift();
  }
  snapshot(): string[] {
    return this.partial === ""
      ? [...this.lines]
      : [...this.lines, redact(this.partial, this.secrets)];
  }
}

export async function startAgent(
  profile: AgentProfile,
  options: StartOptions,
): Promise<AgentConnection> {
  const [command, ...args] = profile.command;
  if (command === undefined) throw new Error(`profile ${profile.id} has an empty command`);
  const extraEnv = { ...profile.env, ...options.env };
  const child: ChildProcess = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const ring = new StderrRing(extraEnv);
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => ring.push(chunk));

  const emitter = new Emitter();
  const open = new Map<string, PermissionRequest & { cancel(): void }>();
  let nextRequest = 1;

  const exited = new Promise<ExitEvent>((resolve) => {
    let done = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (done) return;
      done = true;
      for (const request of open.values()) request.cancel();
      const event = { code, signal, stderr: ring.snapshot() };
      emitter.emit("exit", event);
      resolve(event);
    };
    child.on("exit", finish);
    child.on("error", (error) => {
      ring.push(`spawn error: ${error.message}\n`);
      finish(null, null);
    });
  });

  const app = client({ name: "agentherd" })
    .onNotification(methods.client.session.update, ({ params }) => {
      emitter.emit("update", toUpdateEvent(params));
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      const acpOptions: PermissionOption[] = params.options;
      return new Promise((resolve) => {
        let answered = false;
        const requestId = `p${nextRequest++}`;
        const settle = (answer: PermissionAnswer): boolean => {
          if (answered) return false;
          answered = true;
          open.delete(requestId);
          resolve({ outcome: toAcpOutcome(answer, acpOptions) });
          return true;
        };
        const request = {
          sessionId: params.sessionId,
          requestId,
          toolCallId: params.toolCall.toolCallId,
          toolCall: toToolCallInfo(params.toolCall),
          options: acpOptions.map((o) => ({ id: o.optionId, kind: o.kind, name: o.name })),
          respond: settle,
          get answered() {
            return answered;
          },
          cancel: () => settle({ kind: "cancelled" }),
        };
        open.set(requestId, request);
        emitter.emit("permission", request);
      });
    });

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin as Writable) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout as Readable) as ReadableStream<Uint8Array>,
  );
  const connection: ClientConnection = app.connect(stream);
  const agent = connection.agent;

  const exitError = (e: ExitEvent) =>
    new Error(
      `agent ${profile.id} exited (code ${e.code}, signal ${e.signal})\n${e.stderr.join("\n")}`,
    );
  const failOnExit = exited.then((e) => {
    throw exitError(e);
  });
  failOnExit.catch(() => {});
  // A request also fails when the agent closes stdout. If the process is exiting, report the
  // exit and its stderr instead of the bare "connection closed".
  const whileAlive = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([p, failOnExit]).catch(async (error: unknown) => {
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), EXIT_GRACE_MS).unref());
      const e = await Promise.race([exited, timeout]);
      throw e === null ? error : exitError(e);
    });

  let init: Awaited<ReturnType<typeof initialize>>;
  const initialize = () =>
    agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "agentherd", version: "0.0.0" },
    });
  try {
    init = await whileAlive(initialize());
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    throw error;
  }

  return {
    profile,
    agentName: init.agentInfo?.name ?? profile.name,
    pid: child.pid,
    async newSession(cwd) {
      const res = await whileAlive(
        agent.request(methods.agent.session.new, { cwd, mcpServers: [] }),
      );
      return res.sessionId;
    },
    async prompt(sessionId, text) {
      const res = await whileAlive(
        agent.request(methods.agent.session.prompt, {
          sessionId,
          prompt: [{ type: "text", text }],
        }),
      );
      return { stopReason: res.stopReason };
    },
    async cancel(sessionId) {
      for (const request of [...open.values()]) {
        if (request.sessionId === sessionId) request.cancel();
      }
      await agent.notify(methods.agent.session.cancel, { sessionId });
    },
    on: (event, listener) => emitter.on(event, listener),
    stderr: () => ring.snapshot(),
    async close() {
      connection.close();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await exited;
    },
  };
}
