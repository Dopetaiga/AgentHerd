// Fixed chat commands, used without a Herder model. docs/spec/04-herder.md §6 and plan 008.
// Pure parser: no I/O, no shared state, so it is easy to unit-test.

export type Command =
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "run"; agent: string; dir: string; text: string }
  | { kind: "relay"; query: string }
  | { kind: "end" }
  | { kind: "interrupt"; text: string }
  | { kind: "herder"; text: string }
  | { kind: "text"; text: string }
  | { kind: "invalid"; command: string; usage: string };

const USAGE = {
  run: "/run <agent> <dir> <task>",
  relay: "/relay <task>",
  interrupt: "/interrupt <text>",
  herder: "/herder <text>",
} as const;

interface Token {
  value: string;
  /** Index of the first character after the token. */
  index: number;
}

function invalid(command: keyof typeof USAGE): Command {
  return { kind: "invalid", command, usage: USAGE[command] };
}

function isTokenWhitespace(ch: string): boolean {
  return ch !== "" && /\s/.test(ch);
}

function nextToken(s: string, start: number): Token | undefined {
  let i = start;
  while (i < s.length && isTokenWhitespace(s.charAt(i))) i++;
  if (i >= s.length) return undefined;
  const begin = i;
  while (i < s.length && !isTokenWhitespace(s.charAt(i))) i++;
  return { value: s.slice(begin, i), index: i };
}

/**
 * Strips leading spaces/tabs and at most the first newline run. Inner newlines and
 * everything after them stay verbatim.
 */
function stripTextLeading(s: string): string {
  let i = 0;
  while (i < s.length && (s.charAt(i) === " " || s.charAt(i) === "\t")) i++;
  if (i < s.length && s.charAt(i) === "\n") {
    while (i < s.length && s.charAt(i) === "\n") i++;
    while (i < s.length && (s.charAt(i) === " " || s.charAt(i) === "\t")) i++;
  }
  return s.slice(i);
}

/** Splits a trimmed `/name rest` string into the name and everything after the first space. */
function commandParts(trimmed: string): { name: string; rest: string } {
  const ws = trimmed.search(/\s/);
  if (ws === -1) return { name: trimmed.slice(1), rest: "" };
  return { name: trimmed.slice(1, ws), rest: trimmed.slice(ws + 1) };
}

function parseRun(rest: string): Command {
  const agent = nextToken(rest, 0);
  if (agent === undefined) return invalid("run");
  const dir = nextToken(rest, agent.index);
  if (dir === undefined) return invalid("run");
  const text = stripTextLeading(rest.slice(dir.index)).trimEnd();
  return text === "" ? invalid("run") : { kind: "run", agent: agent.value, dir: dir.value, text };
}

function parseRequired(kind: "relay" | "interrupt" | "herder", rest: string): Command {
  const value = rest.trim();
  if (value === "") return invalid(kind);
  if (kind === "relay") return { kind: "relay", query: value };
  if (kind === "interrupt") return { kind: "interrupt", text: value };
  return { kind: "herder", text: value };
}

export function parseCommand(text: string): Command {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "status") return { kind: "status" };
  if (lower === "/help") return { kind: "help" };
  if (lower === "/end") return { kind: "end" };

  if (!trimmed.startsWith("/")) return { kind: "text", text };

  const { name, rest } = commandParts(trimmed);
  switch (name.toLowerCase()) {
    case "run":
      return parseRun(rest);
    case "relay":
      return parseRequired("relay", rest);
    case "interrupt":
      return parseRequired("interrupt", rest);
    case "herder":
      return parseRequired("herder", rest);
    default:
      return { kind: "text", text: trimmed };
  }
}
