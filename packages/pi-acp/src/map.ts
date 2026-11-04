// Pi tool calls → ACP tool calls (kind, title, locations, rawInput).

import { resolve } from "node:path";
import type { ToolCallLocation, ToolKind } from "@agentclientprotocol/sdk";

export interface PiToolCall {
  toolCallId: string;
  title: string;
  kind: ToolKind;
  rawInput: Record<string, unknown>;
  locations: ToolCallLocation[];
}

const KINDS: Record<string, ToolKind> = {
  bash: "execute",
  powershell: "execute",
  edit: "edit",
  write: "edit",
  read: "read",
  ls: "read",
  grep: "search",
  find: "search",
};

const VERBS: Record<string, string> = {
  edit: "Edit",
  write: "Write",
  read: "Read",
  ls: "List",
  grep: "Search",
  find: "Find",
};

const MAX_TITLE = 200;

function short(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line;
}

/** Long string arguments (a file's new content) are cut so cards and the store stay small. */
export const MAX_ARG_CHARS = 2000;

function shortValues(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] =
      typeof value === "string" && value.length > MAX_ARG_CHARS
        ? `${value.slice(0, MAX_ARG_CHARS)}… (${value.length} chars)`
        : value;
  }
  return out;
}

/**
 * @param toolName Pi's tool name (`bash`, `edit`, a custom tool, …).
 * @param args The call's arguments as Pi reports them.
 * @param cwd The session folder; relative paths resolve against it.
 */
export function toolCallOf(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  cwd: string,
): PiToolCall {
  const path = typeof args.path === "string" ? resolve(cwd, args.path) : undefined;
  const command = typeof args.command === "string" ? args.command : undefined;
  let title: string;
  if (command !== undefined) title = short(command);
  else if (VERBS[toolName] !== undefined) {
    const target = path ?? (typeof args.pattern === "string" ? args.pattern : cwd);
    title = `${VERBS[toolName]} ${short(target)}`;
  } else title = toolName;
  return {
    toolCallId,
    title,
    kind: KINDS[toolName] ?? "other",
    rawInput: shortValues(args),
    locations: path === undefined ? [] : [{ path }],
  };
}
