// An ACP agent backed by Pi in RPC mode (docs/adr/0022). One Pi process per ACP session.
// Pi events become `session/update`; the gate extension's questions become
// `session/request_permission`. Pi's own dialogs from other extensions are cancelled: AgentHerd
// has no UI for them.

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  type AgentApp,
  type AgentContext,
  agent,
  methods,
  PROTOCOL_VERSION,
  RequestError,
  type SessionNotification,
  type StopReason,
} from "@agentclientprotocol/sdk";
import { ALLOW, DENY, decodeQuestion } from "../extension/gate.ts";
import { modelFromEnv, PI_PROVIDER } from "../extension/model.ts";
import { toolCallOf } from "./map.ts";
import { type PiRecord, PiRpc } from "./rpc.ts";

export const GATE_PATH = fileURLToPath(new URL("../extension/gate.ts", import.meta.url));
export const MODEL_PATH = fileURLToPath(new URL("../extension/model.ts", import.meta.url));
export const BRIDGE_NAME = "pi-acp (AgentHerd)";

export interface BridgeOptions {
  /** Pi's command line, for example `["pi"]` or `[node, ".../cli.js"]`. */
  pi: readonly string[];
  /** Extra Pi arguments, such as `--provider deepseek --model deepseek-flash`. */
  piArgs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** Diagnostics and Pi's stderr. Stdout carries ACP. */
  log?: (line: string) => void;
}

/** Rethrows so the ACP client sees the message, not a bare "Internal error". */
function fail(error: Error): never {
  throw RequestError.internalError(undefined, error.message);
}

const DIALOGS = new Set(["select", "confirm", "input", "editor"]);

interface Turn {
  client: AgentContext;
  done: (result: { stopReason: StopReason } | Error) => void;
  error?: string;
  /** Set by `session/cancel`: the turn ends `cancelled` even if Pi finishes it normally. */
  cancelled?: boolean;
}

interface Session {
  id: string;
  cwd: string;
  pi: PiRpc;
  turn: Turn | null;
}

/** Pi's arguments: RPC mode, no saved session, the gate, and the owner's model if one is set. */
export function piArgsFor(piArgs: readonly string[], env: NodeJS.ProcessEnv): string[] {
  const args = ["--mode", "rpc", "--no-session", "-e", GATE_PATH];
  const model = modelFromEnv(env);
  if (model !== undefined)
    args.push("-e", MODEL_PATH, "--provider", PI_PROVIDER, "--model", model.id);
  return [...args, ...piArgs];
}

export function createPiBridge(opts: BridgeOptions): AgentApp & { closeAll(): Promise<void> } {
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const sessions = new Map<string, Session>();

  function update(s: Session, update: SessionNotification["update"]): void {
    const turn = s.turn;
    if (turn === null) return;
    void turn.client
      .notify(methods.client.session.update, {
        sessionId: s.id,
        update,
      })
      .catch(() => {});
  }

  async function ask(s: Session, request: PiRecord): Promise<void> {
    const id = String(request.id);
    const cancel = () => s.pi.send({ type: "extension_ui_response", id, cancelled: true });
    const question =
      request.method === "select" ? decodeQuestion(String(request.title ?? "")) : undefined;
    if (question === undefined || s.turn === null) {
      if (DIALOGS.has(String(request.method))) cancel();
      return;
    }
    const toolCall = toolCallOf(question.toolCallId, question.toolName, question.input, s.cwd);
    try {
      const answer = await s.turn.client.request(methods.client.session.requestPermission, {
        sessionId: s.id,
        toolCall: { ...toolCall, status: "pending" },
        options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        ],
      });
      const chosen = answer.outcome.outcome === "selected" ? answer.outcome.optionId : undefined;
      if (chosen === "allow-once") s.pi.send({ type: "extension_ui_response", id, value: ALLOW });
      else if (chosen === "reject-once") {
        s.pi.send({ type: "extension_ui_response", id, value: DENY });
      } else cancel();
    } catch {
      cancel();
    }
  }

  function onRecord(s: Session, r: PiRecord): void {
    switch (r.type) {
      case "message_update": {
        const e = r.assistantMessageEvent as { type?: string; delta?: unknown } | undefined;
        if (e?.type === "text_delta" && typeof e.delta === "string") {
          update(s, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: e.delta },
          });
        }
        return;
      }
      case "message_end": {
        const m = r.message as { role?: string; stopReason?: string; errorMessage?: string };
        if (m?.role === "assistant" && m.stopReason === "error" && s.turn !== null) {
          s.turn.error = m.errorMessage ?? "Pi's model call failed";
        }
        return;
      }
      case "tool_execution_start": {
        const args = (r.args ?? {}) as Record<string, unknown>;
        const call = toolCallOf(String(r.toolCallId), String(r.toolName), args, s.cwd);
        update(s, { sessionUpdate: "tool_call", ...call, status: "pending" });
        return;
      }
      case "tool_execution_end":
        update(s, {
          sessionUpdate: "tool_call_update",
          toolCallId: String(r.toolCallId),
          status: r.isError === true ? "failed" : "completed",
        });
        return;
      case "extension_ui_request":
        void ask(s, r);
        return;
      case "agent_settled": {
        const turn = s.turn;
        if (turn === null) return;
        s.turn = null;
        if (r.aborted === true || turn.cancelled === true) turn.done({ stopReason: "cancelled" });
        else if (turn.error !== undefined) turn.done(new Error(turn.error));
        else turn.done({ stopReason: "end_turn" });
        return;
      }
    }
  }

  async function startPi(cwd: string): Promise<Session> {
    const s: Session = { id: `pi-${randomUUID()}`, cwd, turn: null, pi: undefined as never };
    const stderr: string[] = [];
    const env = { ...process.env, ...opts.env };
    s.pi = new PiRpc({
      command: opts.pi,
      args: piArgsFor(opts.piArgs ?? [], env),
      cwd,
      env,
      stderr: (chunk) => {
        stderr.push(chunk);
        if (stderr.length > 20) stderr.shift();
        for (const line of chunk.split("\n")) if (line !== "") log(`[pi] ${line}`);
      },
    });
    s.pi.onRecord((r) => onRecord(s, r));
    void s.pi.exited.then((e) => {
      sessions.delete(s.id);
      const turn = s.turn;
      s.turn = null;
      turn?.done(new Error(`Pi exited (code ${e.code}, signal ${e.signal})\n${stderr.join("")}`));
    });
    const state = await s.pi.request({ type: "get_state" });
    if (!state.success) {
      await s.pi.close();
      throw new Error(`Pi did not start: ${state.error ?? "no answer"}\n${stderr.join("")}`);
    }
    return s;
  }

  const app = agent({ name: BRIDGE_NAME })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: BRIDGE_NAME, version: "0.0.0" },
      authMethods: [],
    }))
    .onRequest(methods.agent.session.new, async ({ params }) => {
      const s = await startPi(params.cwd).catch(fail);
      sessions.set(s.id, s);
      return { sessionId: s.id };
    })
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      const s = sessions.get(params.sessionId);
      if (s === undefined) throw new Error(`unknown session ${params.sessionId}`);
      if (s.turn !== null) throw new Error("a turn is already running");
      const text = params.prompt
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n");
      const result = new Promise<{ stopReason: StopReason } | Error>((resolve) => {
        s.turn = { client, done: resolve };
      });
      const accepted = await s.pi.request({ type: "prompt", message: text });
      if (
        !accepted.success ||
        (accepted.data as { disposition?: string })?.disposition === "handled"
      ) {
        s.turn = null;
        if (!accepted.success) fail(new Error(accepted.error ?? "Pi refused the prompt"));
        return { stopReason: "end_turn" };
      }
      const outcome = await result;
      if (outcome instanceof Error) fail(outcome);
      return outcome;
    })
    .onNotification(methods.agent.session.cancel, async ({ params }) => {
      const s = sessions.get(params.sessionId);
      if (s === undefined || s.turn === null) return;
      s.turn.cancelled = true;
      await s.pi.request({ type: "abort" });
    });

  return Object.assign(app, {
    async closeAll() {
      await Promise.all([...sessions.values()].map((s) => s.pi.close()));
    },
  });
}
