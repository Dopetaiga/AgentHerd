// The only place that turns AgentHerd decisions into ACP outcomes and ACP tool calls into
// AgentHerd ToolCallInfo (docs/spec/03-agents.md "ACP mapping").

import type {
  PermissionOption,
  RequestPermissionOutcome,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type { ToolCallInfo } from "@agentherd/protocol";

export type PermissionAnswer = { kind: "allow" } | { kind: "deny" } | { kind: "cancelled" };

/**
 * `allow` → the `allow_once` option, never `allow_always`: an "always" rule lives in AgentHerd,
 * not in the agent. `deny` → `reject_once`, else any `reject_*`. Otherwise `cancelled`.
 */
export function toAcpOutcome(
  answer: PermissionAnswer,
  options: readonly PermissionOption[],
): RequestPermissionOutcome {
  const pick = (kinds: readonly string[]): RequestPermissionOutcome => {
    for (const kind of kinds) {
      const option = options.find((o) => o.kind === kind);
      if (option !== undefined) return { outcome: "selected", optionId: option.optionId };
    }
    return { outcome: "cancelled" };
  };
  switch (answer.kind) {
    case "allow":
      return pick(["allow_once"]);
    case "deny":
      return pick(["reject_once", "reject_always"]);
    case "cancelled":
      return { outcome: "cancelled" };
  }
}

function commandOf(rawInput: unknown): string | undefined {
  if (typeof rawInput !== "object" || rawInput === null) return undefined;
  const command = (rawInput as { command?: unknown }).command;
  if (typeof command === "string") return command;
  if (Array.isArray(command) && command.every((c) => typeof c === "string")) {
    return command.join(" ");
  }
  return undefined;
}

export function toToolCallInfo(call: ToolCallUpdate): ToolCallInfo {
  const info: ToolCallInfo = {
    kind: call.kind ?? "other",
    title: call.title ?? call.toolCallId,
    paths: (call.locations ?? []).map((l) => l.path),
  };
  const command = commandOf(call.rawInput);
  if (command !== undefined) info.command = command;
  if (call.rawInput !== undefined && call.rawInput !== null) info.rawInput = call.rawInput;
  return info;
}
