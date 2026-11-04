// The guard list: built-in matches that always send a request to the owner.
// docs/spec/04-herder.md §3 "Guard list". It is intentionally coarse: a false hit costs one
// tap, a miss can cost data. It never allows anything; it only says "ask the owner".

import path from "node:path";
import type { ToolCallInfo } from "@agentherd/protocol";
import { globMatch } from "./glob.ts";
import { isInside, type PathContext, pathCandidates, resolveWord } from "./paths.ts";
import {
  basename,
  programWords,
  type Segment,
  splitCommand,
  UnparsedCommandError,
} from "./shell.ts";

export type GuardResult = { hit: true; id: string; reason: string } | { hit: false };

/** An extra entry from configuration. It adds hits; it can never remove a built-in one. */
export interface ExtraGuard {
  id: string;
  reason: string;
  /** Glob (`*` only) against each command segment, words joined by one space. */
  command?: string;
  /** Any path inside this directory (`~` allowed). */
  pathPrefix?: string;
}

export const BUILT_IN_GUARDS = [
  { id: "rm-outside-cwd", reason: "Recursive delete outside the working directory" },
  { id: "force-push", reason: "Force push" },
  { id: "pipe-to-shell", reason: "Downloaded content piped into a shell or interpreter" },
  { id: "secret-read", reason: "Touches secrets (SSH, cloud or GPG keys, .env, keychain)" },
  { id: "self-config", reason: "Changes AgentHerd's or an agent's permission configuration" },
  { id: "sudo", reason: "Runs as root" },
] as const;

type GuardId = (typeof BUILT_IN_GUARDS)[number]["id"];

const DOWNLOADERS = new Set(["curl", "wget"]);
const INTERPRETERS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "python",
  "python3",
  "node",
  "perl",
  "ruby",
]);
const SECRET_DIRS = [".ssh", ".aws", ".gnupg"];
const SELF_CONFIG_DIRS = [".agentherd", ".codex"];

function hit(id: GuardId | string, reason?: string): GuardResult {
  const builtIn = BUILT_IN_GUARDS.find((g) => g.id === id);
  return { hit: true, id, reason: reason ?? builtIn?.reason ?? id };
}

export function guardCheck(
  call: ToolCallInfo,
  ctx: PathContext,
  extraGuards: readonly ExtraGuard[] = [],
): GuardResult {
  let segments: Segment[] = [];
  if (call.command !== undefined && call.command.trim() !== "") {
    try {
      segments = splitCommand(call.command);
    } catch (error) {
      if (error instanceof UnparsedCommandError) return hit("unparsed", error.message);
      throw error;
    }
  }

  const commandPaths: string[] = [];
  for (const segment of segments) {
    for (const word of segment.words) {
      for (const candidate of pathCandidates(word)) {
        const resolved = resolveWord(candidate, ctx);
        if (resolved !== null) commandPaths.push(resolved);
      }
    }
  }
  const callPaths = call.paths.map((p) => resolveWord(p, ctx) ?? p);
  const allPaths = [...callPaths, ...commandPaths];

  const results: GuardResult[] = [
    checkRm(call, segments, callPaths, ctx),
    checkForcePush(segments),
    checkPipeToShell(segments),
    checkSecrets(segments, allPaths, ctx),
    checkSelfConfig(allPaths, ctx),
    checkSudo(segments),
    checkExtra(extraGuards, segments, allPaths, ctx),
  ];
  return results.find((r) => r.hit) ?? { hit: false };
}

function isRecursiveFlag(word: string): boolean {
  if (word === "--recursive") return true;
  return /^-[A-Za-z]*[rR][A-Za-z]*$/.test(word);
}

function rmTargetsEscape(args: readonly string[], ctx: PathContext): boolean {
  let recursive = false;
  const targets: string[] = [];
  let endOfOptions = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string;
    if (!endOfOptions && word === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && /^\d*(>>?|<|&>>?)&?$/.test(word)) {
      i += 1; // skip the redirection target
      continue;
    }
    if (!endOfOptions && word.startsWith("-") && word !== "-") {
      if (isRecursiveFlag(word)) recursive = true;
      continue;
    }
    targets.push(word);
  }
  if (!recursive) return false;
  return targets.some((t) => {
    const resolved = resolveWord(t, ctx);
    return resolved === null || !isInside(resolved, ctx.cwd);
  });
}

function checkRm(
  call: ToolCallInfo,
  segments: readonly Segment[],
  callPaths: readonly string[],
  ctx: PathContext,
): GuardResult {
  if (call.kind === "delete" && callPaths.some((p) => !isInside(p, ctx.cwd))) {
    return hit("rm-outside-cwd");
  }
  for (const segment of segments) {
    const words = programWords(segment.words);
    const program = basename(words[0] ?? "");
    if (program === "rm" && rmTargetsEscape(words.slice(1), ctx)) return hit("rm-outside-cwd");
    // `xargs rm -r` and `find -exec rm -r`: the targets are unknown.
    if (program === "xargs") {
      const inner = programWords(words.slice(1).filter((w) => !w.startsWith("-")));
      if (basename(inner[0] ?? "") === "rm" && words.some(isRecursiveFlag)) {
        return hit("rm-outside-cwd");
      }
    }
    if (program === "find") {
      const exec = words.findIndex((w) => w === "-exec" || w === "-execdir");
      if (exec !== -1 && basename(words[exec + 1] ?? "") === "rm") {
        if (words.slice(exec + 2).some(isRecursiveFlag)) return hit("rm-outside-cwd");
      }
    }
  }
  return { hit: false };
}

function checkForcePush(segments: readonly Segment[]): GuardResult {
  for (const segment of segments) {
    const words = programWords(segment.words);
    if (basename(words[0] ?? "") !== "git") continue;
    const push = words.indexOf("push");
    if (push === -1) continue;
    const args = words.slice(push + 1);
    const forced = args.some(
      (w) =>
        w === "--force" ||
        w.startsWith("--force-with-lease") ||
        w === "--force-if-includes" ||
        /^-[A-Za-z]*f[A-Za-z]*$/.test(w) ||
        (w.startsWith("+") && w.length > 1),
    );
    if (forced) return hit("force-push");
  }
  return { hit: false };
}

function checkPipeToShell(segments: readonly Segment[]): GuardResult {
  let downloadInPipeline = false;
  for (const segment of segments) {
    if (segment.joinedBy !== "|") downloadInPipeline = false;
    const program = basename(programWords(segment.words)[0] ?? "");
    if (segment.joinedBy === "|" && downloadInPipeline && INTERPRETERS.has(program)) {
      return hit("pipe-to-shell");
    }
    if (DOWNLOADERS.has(program)) downloadInPipeline = true;
  }
  return { hit: false };
}

function isSecretPath(p: string, ctx: PathContext): boolean {
  if (SECRET_DIRS.some((d) => isInside(p, path.join(ctx.home, d)))) return true;
  return /^\.env(\..+)?$/.test(path.basename(p));
}

function checkSecrets(
  segments: readonly Segment[],
  paths: readonly string[],
  ctx: PathContext,
): GuardResult {
  if (paths.some((p) => isSecretPath(p, ctx))) return hit("secret-read");
  for (const segment of segments) {
    const words = programWords(segment.words);
    if (basename(words[0] ?? "") !== "security") continue;
    const sub = words[1] ?? "";
    if (/^find-.*-password$/.test(sub) || sub === "dump-keychain") return hit("secret-read");
  }
  return { hit: false };
}

function checkSelfConfig(paths: readonly string[], ctx: PathContext): GuardResult {
  for (const p of paths) {
    if (SELF_CONFIG_DIRS.some((d) => isInside(p, path.join(ctx.home, d)))) {
      return hit("self-config");
    }
    if (
      path.basename(path.dirname(p)) === ".claude" &&
      /^settings.*\.json$/.test(path.basename(p))
    ) {
      return hit("self-config");
    }
  }
  return { hit: false };
}

function checkSudo(segments: readonly Segment[]): GuardResult {
  for (const segment of segments) {
    // Words before the real program: assignments and wrappers (`env`, `nohup`, `sudo`, ...).
    const prefix = segment.words.slice(
      0,
      segment.words.length - programWords(segment.words).length,
    );
    if (prefix.some((w) => basename(w) === "sudo" || basename(w) === "doas")) return hit("sudo");
  }
  return { hit: false };
}

function checkExtra(
  extra: readonly ExtraGuard[],
  segments: readonly Segment[],
  paths: readonly string[],
  ctx: PathContext,
): GuardResult {
  for (const guard of extra) {
    const command = guard.command;
    if (command !== undefined && segments.some((s) => globMatch(command, s.words.join(" ")))) {
      return hit(guard.id, guard.reason);
    }
    if (guard.pathPrefix !== undefined) {
      const dir = resolveWord(guard.pathPrefix, ctx);
      if (dir !== null && paths.some((p) => isInside(p, dir))) return hit(guard.id, guard.reason);
    }
  }
  return { hit: false };
}
