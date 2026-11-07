// The core side of the agent MCP gateway (docs/spec/09-agent-tools.md §1–§2). The host carries
// JSON-RPC lines between an agent's relay script and `handle`; the token says which task speaks.

import { randomBytes } from "node:crypto";
import type { ReportState } from "@agentherd/protocol";

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** A token no task holds (never given out, or revoked when the task ended). */
export class UnknownTokenError extends Error {
  constructor() {
    super("unknown task token");
    this.name = "UnknownTokenError";
  }
}

/** docs/spec/04-herder.md §2 */
export interface HerdReport {
  state: ReportState;
  summary: string;
  changes?: string[];
  tests?: string[];
  risks?: string[];
  links?: string[];
}

export const REPORT_SUMMARY_MAX = 600;
const STATES: readonly ReportState[] = [
  "progress",
  "waiting",
  "ready",
  "blocked",
  "failed",
  "dropped",
];
const LISTS = ["changes", "tests", "risks", "links"] as const;
const VERSIONS = ["2025-06-18", "2025-03-26"];

const stringList = { type: "array", items: { type: "string" } };

export const HERD_REPORT_TOOL = {
  name: "herd_report",
  description:
    "Tell AgentHerd (and the owner) where this task stands. Call it when you finish, get stuck, " +
    "need the owner, or give up. state: progress | waiting (need the owner) | ready (done) | " +
    "blocked | failed | dropped. summary: one short paragraph for the owner, at most 600 characters.",
  inputSchema: {
    type: "object",
    properties: {
      state: { type: "string", enum: [...STATES] },
      summary: { type: "string", maxLength: REPORT_SUMMARY_MAX },
      changes: stringList,
      tests: stringList,
      risks: stringList,
      links: stringList,
    },
    required: ["state", "summary"],
    additionalProperties: false,
  },
} as const;

/** The report, or why it is not one. */
export function parseReport(input: unknown): HerdReport | string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return "arguments must be an object";
  }
  const v = input as Record<string, unknown>;
  if (typeof v.state !== "string" || !STATES.includes(v.state as ReportState)) {
    return `state must be one of ${STATES.join(", ")}`;
  }
  if (typeof v.summary !== "string" || v.summary.trim() === "") return "summary is required";
  const report: HerdReport = {
    state: v.state as ReportState,
    summary: v.summary.slice(0, REPORT_SUMMARY_MAX),
  };
  for (const key of LISTS) {
    const list = v[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) {
      return `${key} must be a list of strings`;
    }
    report[key] = list;
  }
  return report;
}

const toolText = (text: string, isError = false) => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError: true } : {}),
});

export class McpGateway {
  private readonly tasks = new Map<string, string>();
  private readonly tokens = new Map<string, string>();
  private readonly onReport: (taskId: string, report: HerdReport) => void;

  constructor(onReport: (taskId: string, report: HerdReport) => void) {
    this.onReport = onReport;
  }

  /** A new token for the task; an older one stops working. */
  register(taskId: string): string {
    this.revoke(taskId);
    const token = randomBytes(32).toString("hex");
    this.tasks.set(token, taskId);
    this.tokens.set(taskId, token);
    return token;
  }

  revoke(taskId: string): void {
    const token = this.tokens.get(taskId);
    if (token === undefined) return;
    this.tokens.delete(taskId);
    this.tasks.delete(token);
  }

  taskOf(token: string): string | undefined {
    return this.tasks.get(token);
  }

  /** The answer to one message, `undefined` for notifications and stray responses. */
  handle(token: string, msg: JsonRpcMessage): JsonRpcMessage | undefined {
    const taskId = this.tasks.get(token);
    if (taskId === undefined) throw new UnknownTokenError();
    const id = msg.id;
    if (msg.method === undefined || id === undefined || id === null) return undefined;
    const answer = (result: unknown): JsonRpcMessage => ({ jsonrpc: "2.0", id, result });
    const params = (msg.params ?? {}) as Record<string, unknown>;
    switch (msg.method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return answer({
          protocolVersion:
            typeof asked === "string" && VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "agentherd", version: "1" },
        });
      }
      case "ping":
        return answer({});
      case "tools/list":
        return answer({ tools: [HERD_REPORT_TOOL] });
      case "tools/call": {
        if (params.name !== HERD_REPORT_TOOL.name) {
          return answer(toolText(`unknown tool ${String(params.name)}`, true));
        }
        const report = parseReport(params.arguments);
        if (typeof report === "string") return answer(toolText(report, true));
        this.onReport(taskId, report);
        return answer(toolText("reported"));
      }
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${msg.method}` },
        };
    }
  }
}
