// Owner rules (docs/spec/04-herder.md §3 "Rules"). The matcher has no guard logic: the caller
// runs `guardCheck` first and never calls `matchRules` for an item that hit the guard list.

import type { Item, PathScope, Rule } from "@agentherd/protocol";
import { globMatch } from "./glob.ts";
import { normalizeCommand } from "./normalize.ts";
import { isInside, pathCandidates, resolveWord } from "./paths.ts";
import { type Segment, splitCommand, UnparsedCommandError } from "./shell.ts";

export interface RuleHit {
  rule: Rule;
  action: "allow" | "deny";
}

/** First matching rule. `deny` wins over `allow`; within one action the first rule wins. */
export function matchRules(rules: readonly Rule[], item: Item, home: string): RuleHit | null {
  const parsed = parseItemCommand(item);
  let allow: Rule | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule, item, parsed, home)) continue;
    if (rule.action === "deny") return { rule, action: "deny" };
    allow ??= rule;
  }
  return allow === null ? null : { rule: allow, action: "allow" };
}

type ParsedCommand =
  | { kind: "none" }
  | { kind: "unparsed" }
  | { kind: "ok"; normalized: string; segments: Segment[] };

function parseItemCommand(item: Item): ParsedCommand {
  const command = item.toolCall?.command;
  if (command === undefined || command.trim() === "") return { kind: "none" };
  try {
    return { kind: "ok", normalized: normalizeCommand(command), segments: splitCommand(command) };
  } catch (error) {
    if (error instanceof UnparsedCommandError) return { kind: "unparsed" };
    throw error;
  }
}

function ruleMatches(rule: Rule, item: Item, parsed: ParsedCommand, home: string): boolean {
  const m = rule.match;
  if (m.profileId !== undefined && m.profileId !== item.profileId) return false;
  if (m.eventType !== undefined && item.kind !== m.eventType) return false;
  if (m.toolKind !== undefined && item.toolCall?.kind !== m.toolKind) return false;
  if (m.command !== undefined && !commandMatches(m.command, rule.action, parsed)) return false;
  if (m.pathScope !== undefined && !inScope(m.pathScope, item, parsed, home)) return false;
  return true;
}

function commandMatches(glob: string, action: Rule["action"], parsed: ParsedCommand): boolean {
  if (parsed.kind === "none") return false;
  if (parsed.kind === "unparsed") {
    // An unreadable command can never be allowed by a rule. A deny rule cannot see inside it
    // either, so it does not match; the item goes on to the next tier.
    return false;
  }
  const segmentTexts = parsed.segments.map((s) => normalizeCommand(s.words.join(" ")));
  if (action === "allow") {
    // `pnpm test*` must not allow `pnpm test && git push`: compound commands never match an
    // allow rule.
    return parsed.segments.length === 1 && globMatch(glob, parsed.normalized);
  }
  return globMatch(glob, parsed.normalized) || segmentTexts.some((t) => globMatch(glob, t));
}

function looksLikePath(word: string): boolean {
  return word.includes("/") || word.startsWith("~") || word.startsWith(".") || word.includes("$");
}

function inScope(scope: PathScope, item: Item, parsed: ParsedCommand, home: string): boolean {
  const ctx = { cwd: item.cwd, home };
  const dir = scope.kind === "cwd" ? item.cwd : resolveWord(scope.path, ctx);
  if (dir === null) return false;

  // Both the paths the agent reported and the path-like words of the command must stay inside.
  const paths = item.toolCall?.paths ?? [];
  const pathsInside = paths.every((p) => {
    const resolved = resolveWord(p, ctx);
    return resolved !== null && isInside(resolved, dir);
  });
  if (!pathsInside) return false;
  if (parsed.kind === "unparsed") return false;
  if (parsed.kind === "none") return true;
  for (const segment of parsed.segments) {
    for (const word of segment.words.slice(1)) {
      for (const candidate of pathCandidates(word)) {
        if (!looksLikePath(candidate)) continue;
        const resolved = resolveWord(candidate, ctx);
        if (resolved === null || !isInside(resolved, dir)) return false;
      }
    }
  }
  return true;
}
