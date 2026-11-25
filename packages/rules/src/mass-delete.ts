// Mass delete: the one kind of agent request that still goes to the owner (ADR 0029). Everything
// else is approved by AgentHerd. "Mass" means the target is the project folder itself, a folder
// above it, the home folder, `/`, anything outside the project, everything in a folder (`*`), or
// targets nobody can know before the command runs (a variable, `xargs`, `find -delete`).
// It is coarse on purpose: a false hit costs one tap, a miss can cost a project. The one place it
// never asks about is a temporary folder (/tmp and the system's own): nothing there is the owner's.

import { tmpdir } from "node:os";
import type { ToolCallInfo } from "@agentherd/protocol";
import type { GuardResult } from "./guard.ts";
import {
  isInside,
  isWinPath,
  type PathContext,
  pathModFor,
  resolveWord,
  sameResolvedPath,
} from "./paths.ts";
import {
  basename,
  type JoinOperator,
  programWords,
  type RichSegment,
  splitCommandRich,
  type Token,
  UnparsedCommandError,
} from "./shell.ts";

export const MASS_DELETE = { id: "mass-delete", reason: "Deletes a lot at once" } as const;

const MISS: GuardResult = { hit: false };
const HIT: GuardResult = { hit: true, ...MASS_DELETE };
const CMD_DELETE_SWITCH = /^(?:\/(?:s|q|f|p|a(?::[A-Za-z-]+)?))+$/i;
const CMD_GLUED_PROGRAM = /^(rd|rmdir|del|erase)(\/.*)$/i;
const DELETE_PROGRAMS = new Set(["rm", "rmdir", "rd", "del", "erase", "remove-item", "ri"]);
const CMD_STYLE_DELETERS = new Set(["rmdir", "rd", "del", "erase"]);
const CD_PROGRAMS = new Set(["cd", "chdir", "set-location", "sl", "pushd", "push-location"]);
const POP_CD_PROGRAMS = new Set(["popd", "pop-location"]);
const MAX_SHELL_DEPTH = 4;
const DELETE_KEYWORD =
  /\b(?:rm|rmdir|rd|del|erase|remove-item|ri|trash)\b|-delete\b|-(?:encodedcommand|enc(?:oded?)?|ec|e)\b/i;

const PS_NO_VALUE_PREFIXES = [
  "nologo",
  "noprofile",
  "noninteractive",
  "noexit",
  "noprofileloadtime",
  "sta",
  "mta",
  "login",
  "help",
];
const PS_NO_VALUE_ALIASES = new Set(["nol", "nop", "noni", "noe", "l", "h", "?"]);
const PS_VALUE_PREFIXES = [
  "executionpolicy",
  "inputformat",
  "outputformat",
  "windowstyle",
  "configurationname",
  "version",
  "settingsfile",
  "custompipename",
  "custompipe",
  "workingdirectory",
  "redirectstandarderror",
];
const PS_VALUE_ALIASES = new Set(["ep", "ex", "if", "of", "w", "v", "wd"]);

const PS_RM_SKIP_PREFIXES = [
  "filter",
  "include",
  "exclude",
  "credential",
  "stream",
  "erroraction",
  "warningaction",
  "informationaction",
  "progressaction",
  "errorvariable",
  "warningvariable",
  "informationvariable",
  "outvariable",
  "outbuffer",
  "pipelinevariable",
];
const PS_RM_SKIP_ALIASES = new Set(["ea", "wa", "infa", "ev", "wv", "iv", "ov", "ob", "pv"]);

type ShellDialect = "default" | "cmd" | "powershell";

/**
 * The temporary folders: whatever is in them may go without asking ("删tmp里的东西都无所谓",
 * the owner, 2026-11-23). `/tmp` is `/private/tmp` on macOS, and `os.tmpdir()` is the per-user
 * folder under `/var/folders`; both spellings are listed because paths are not followed.
 */
export const TEMP_DIRS: readonly string[] = [
  ...new Set(
    ["/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp", tmpdir()].flatMap((d) =>
      d.startsWith("/var/") ? [d, `/private${d}`] : [d],
    ),
  ),
];

/** True when `target` is inside a temporary folder (or is one, when only its contents go). */
function inTemp(target: string, wholeFolder: boolean): boolean {
  return TEMP_DIRS.some(
    (dir) =>
      isWinPath(target) === isWinPath(dir) &&
      isInside(target, dir) &&
      (!sameResolvedPath(target, dir) || !wholeFolder),
  );
}

/** True when deleting `word` would remove more than files the agent can name one by one. */
function isWide(word: string, ctx: PathContext, here: string = ctx.cwd): boolean {
  // `src/*.log` is narrow; `*`, `*.*`, `./*`, `dir/*`, `dir\*.*` or `.*` empties a folder.
  const base = pathModFor(word, here, ctx.cwd).basename(word);
  const emptiesFolder = base === "*" || base === ".*" || base === "*.*";
  const stripped = word.replace(/[\\/](?:\*|\.\*|\*\.\*)$/, "");
  const target = stripped === "" ? "/" : /^[A-Za-z]:$/.test(stripped) ? `${stripped}\\` : stripped;
  const resolved = resolveWord(target, { ...ctx, cwd: here });
  // Anything inside a temporary folder, even all of it, is fine; the folder itself is not, and
  // neither is the project or a folder holding it when the project itself lives in one.
  if (
    resolved !== null &&
    !isInside(ctx.cwd, resolved) &&
    inTemp(resolved, !emptiesFolder || stripped === word)
  ) {
    return false;
  }
  if (emptiesFolder) return true;
  if (resolved === null) return true;
  if (!isInside(resolved, ctx.cwd)) return true;
  if (sameResolvedPath(resolved, ctx.cwd)) return true;
  return false;
}

function matchesPsPrefix(
  name: string,
  prefixes: readonly string[],
  aliases: ReadonlySet<string>,
): boolean {
  if (aliases.has(name)) return true;
  return name.length >= 2 && prefixes.some((p) => p.startsWith(name));
}

function splitPsFlag(word: string): { name: string; inlineValue?: string } | null {
  if (!word.startsWith("-") || word === "-") return null;
  const body = word.slice(1);
  const sep = body.search(/[:=]/);
  if (sep === -1) return { name: body.toLowerCase() };
  return { name: body.slice(0, sep).toLowerCase(), inlineValue: body.slice(sep + 1) };
}

function splitTargetToken(
  token: Token,
  rawCommand: string,
  prefixLen: number,
  splitCommas: boolean,
  inArray: boolean,
): { targets: string[]; inArray: boolean; unknown: boolean } {
  const rawSlice = rawCommand.slice(token.start + prefixLen, token.end);
  if (splitCommas && rawSlice.startsWith("(")) {
    return { targets: [], inArray, unknown: true };
  }

  let startOffset = prefixLen;
  let endOffset = token.value.length;
  let arrayState = inArray;

  if (splitCommas) {
    if (rawSlice.startsWith("@(")) {
      startOffset += 2;
      arrayState = true;
    }
    if (arrayState && rawSlice.endsWith(")")) {
      endOffset -= 1;
      arrayState = false;
    }
  }

  if (!splitCommas) {
    const val = token.value.slice(startOffset, endOffset);
    return { targets: val === "" ? [] : [val], inArray: arrayState, unknown: false };
  }

  const targets: string[] = [];
  let cursor = startOffset;
  for (const commaIdx of token.unquotedCommas) {
    if (commaIdx < startOffset || commaIdx >= endOffset) continue;
    const part = token.value.slice(cursor, commaIdx);
    if (part !== "") targets.push(part);
    cursor = commaIdx + 1;
  }
  const tail = token.value.slice(cursor, endOffset);
  if (tail !== "") targets.push(tail);
  return { targets, inArray: arrayState, unknown: false };
}

function rmTargets(
  args: readonly Token[],
  rawCommand: string,
  allowCmdSwitches: boolean,
  splitCommas: boolean,
  isPowerShell: boolean,
): { targets: string[]; unknown: boolean } {
  const targets: string[] = [];
  let endOfOptions = false;
  let inArray = false;

  const pushToken = (token: Token, prefixLen: number): boolean => {
    const res = splitTargetToken(token, rawCommand, prefixLen, splitCommas, inArray);
    inArray = res.inArray;
    if (res.unknown) return false;
    for (const item of res.targets) targets.push(item);
    return true;
  };

  for (let i = 0; i < args.length; i++) {
    const token = args[i] as Token;
    const word = token.value;
    if (!endOfOptions && word === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && /^\d*(>>?|<|&>>?)&?$/.test(word)) {
      i += 1;
      continue;
    }
    if (!endOfOptions && allowCmdSwitches && CMD_DELETE_SWITCH.test(word)) continue;
    if (!endOfOptions) {
      const flag = splitPsFlag(word);
      if (flag !== null) {
        const isPathFlag =
          flag.name === "lp" ||
          (flag.name.length >= 2 &&
            ("path".startsWith(flag.name) || "literalpath".startsWith(flag.name)));
        if (isPathFlag) {
          if (flag.inlineValue !== undefined) {
            const prefixLen = word.length - flag.inlineValue.length;
            if (!pushToken(token, prefixLen)) return { targets, unknown: true };
          } else if (isPowerShell) {
            const next = args[++i];
            if (next !== undefined && !pushToken(next, 0)) return { targets, unknown: true };
          }
          continue;
        }
        if (isPowerShell && matchesPsPrefix(flag.name, PS_RM_SKIP_PREFIXES, PS_RM_SKIP_ALIASES)) {
          if (flag.inlineValue === undefined) i += 1;
          continue;
        }
        continue;
      }
    }
    if (!pushToken(token, 0)) return { targets, unknown: true };
  }
  return { targets, unknown: false };
}

function cdTarget(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const w = args[i] as string;
    if (/^\/d$/i.test(w) || /^-(?:L|P|e|PassThru)$/i.test(w)) continue;
    const flag = splitPsFlag(w);
    if (flag !== null) {
      if (
        flag.name === "lp" ||
        (flag.name.length >= 2 &&
          ("path".startsWith(flag.name) || "literalpath".startsWith(flag.name)))
      ) {
        return flag.inlineValue ?? args[i + 1] ?? "~";
      }
      return null;
    }
    return w;
  }
  return "~";
}

type ShellUnwrap =
  | { kind: "none" }
  | { kind: "escalate" }
  | { kind: "text"; text: string; dialect: ShellDialect; dir?: string };

function decodeEncodedCommand(raw: string): string | null {
  const cleaned = raw.trim();
  if (cleaned === "" || cleaned.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    return null;
  }
  const buf = Buffer.from(cleaned, "base64");
  if (buf.length === 0 || buf.length % 2 !== 0) return null;
  if (buf.toString("base64").replace(/=+$/, "") !== cleaned.replace(/=+$/, "")) return null;
  const text = buf.toString("utf16le");
  if (text.includes("\0")) return null;
  return text;
}

function unwrapCmd(
  args: readonly Token[],
  joinedBy: JoinOperator | null,
  rawCommand: string,
  isWholeCommand: boolean,
  canOwnRemainder: boolean,
): ShellUnwrap {
  let hasSlashS = false;
  for (let i = 0; i < args.length; i++) {
    const token = args[i] as Token;
    const w = token.value;
    if (/^\/s$/i.test(w)) {
      hasSlashS = true;
      continue;
    }
    if (/^\/(?:c|k)$/i.test(w)) {
      const rest = args.slice(i + 1);
      if (rest.length === 0) return { kind: "none" };
      const rawRest = rawCommand.slice(token.end).trim();
      if (
        isWholeCommand &&
        rawRest.startsWith('"') &&
        rawRest.endsWith('"') &&
        (hasSlashS || rest.length === 1)
      ) {
        return { kind: "text", text: rawRest.slice(1, -1), dialect: "cmd" };
      }
      if (canOwnRemainder && !rawRest.startsWith('"') && !rawRest.startsWith("'")) {
        return { kind: "text", text: rawRest, dialect: "cmd" };
      }
      return { kind: "text", text: rest.map((t) => t.value).join(" "), dialect: "cmd" };
    }
    const glued = /^\/(?:c|k)(.+)$/i.exec(w);
    if (glued !== null) {
      const rest = [glued[1] as string, ...args.slice(i + 1).map((t) => t.value)];
      if (canOwnRemainder) {
        const rawRest = rawCommand.slice(token.start + 2).trim();
        if (!rawRest.startsWith('"') && !rawRest.startsWith("'")) {
          return { kind: "text", text: rawRest, dialect: "cmd" };
        }
      }
      return { kind: "text", text: rest.join(" "), dialect: "cmd" };
    }
    if (/^\/[a-z](?::[^\s]+)?$/i.test(w)) continue;
    return joinedBy === "|" ? { kind: "escalate" } : { kind: "none" };
  }
  return joinedBy === "|" ? { kind: "escalate" } : { kind: "none" };
}

function unwrapPowerShell(
  args: readonly Token[],
  joinedBy: JoinOperator | null,
  rawCommand: string,
  canOwnRemainder: boolean,
): ShellUnwrap {
  let dir: string | undefined;
  let encodedRaw: string | undefined;
  let sawFile = false;
  const withDir = (inner: ShellUnwrap): ShellUnwrap =>
    dir === undefined || inner.kind !== "text" ? inner : { ...inner, dir };

  for (let i = 0; i < args.length; i++) {
    const token = args[i] as Token;
    const w = token.value;
    if (w === "-") return { kind: "escalate" };
    const flag = splitPsFlag(w);
    if (flag !== null) {
      if (matchesPsPrefix(flag.name, PS_NO_VALUE_PREFIXES, PS_NO_VALUE_ALIASES)) continue;
      if (matchesPsPrefix(flag.name, PS_VALUE_PREFIXES, PS_VALUE_ALIASES)) {
        const val = flag.inlineValue ?? args[++i]?.value;
        if (val === undefined) return { kind: "escalate" };
        if (flag.name === "wd" || "workingdirectory".startsWith(flag.name)) dir = val;
        continue;
      }
      if (flag.name === "f" || (flag.name.length >= 2 && "file".startsWith(flag.name))) {
        const fileArg = flag.inlineValue ?? args[++i]?.value;
        if (fileArg === undefined || fileArg === "-") return { kind: "escalate" };
        sawFile = true;
        break;
      }
      if (
        flag.name === "e" ||
        flag.name === "ec" ||
        (flag.name.length >= 2 && "encodedcommand".startsWith(flag.name))
      ) {
        const val = flag.inlineValue ?? args[++i]?.value;
        if (val === undefined) return { kind: "escalate" };
        encodedRaw = val;
        continue;
      }
      if (
        flag.name === "c" ||
        flag.name === "ca" ||
        (flag.name.length >= 2 &&
          ("command".startsWith(flag.name) || "commandwithargs".startsWith(flag.name)))
      ) {
        const rest =
          flag.inlineValue !== undefined
            ? [flag.inlineValue, ...args.slice(i + 1).map((t) => t.value)]
            : args.slice(i + 1).map((t) => t.value);
        if (rest.length === 0) return { kind: "none" };
        if (rest[0] === "-") return { kind: "escalate" };
        if (flag.inlineValue === undefined && canOwnRemainder) {
          const rawRest = rawCommand.slice(token.end).trim();
          if (!rawRest.startsWith('"') && !rawRest.startsWith("'")) {
            return withDir({ kind: "text", text: rawRest, dialect: "powershell" });
          }
        }
        return withDir({ kind: "text", text: rest.join(" "), dialect: "powershell" });
      }
      continue;
    }

    if (encodedRaw !== undefined) continue;
    const rest = args.slice(i).map((t) => t.value);
    if (canOwnRemainder) {
      const rawRest = rawCommand.slice(token.start).trim();
      if (!rawRest.startsWith('"') && !rawRest.startsWith("'")) {
        return withDir({ kind: "text", text: rawRest, dialect: "powershell" });
      }
    }
    return withDir({ kind: "text", text: rest.join(" "), dialect: "powershell" });
  }

  if (encodedRaw !== undefined) {
    const decoded = decodeEncodedCommand(encodedRaw);
    return decoded === null
      ? { kind: "escalate" }
      : withDir({ kind: "text", text: decoded, dialect: "powershell" });
  }
  if (sawFile) return { kind: "none" };
  return joinedBy === "|" ? { kind: "escalate" } : { kind: "none" };
}

function unwrapWindowsShell(
  program: string,
  args: readonly Token[],
  joinedBy: JoinOperator | null,
  rawCommand: string,
  isWholeCommand: boolean,
  canOwnRemainder: boolean,
): ShellUnwrap {
  if (program === "cmd" || program === "%comspec%") {
    return unwrapCmd(args, joinedBy, rawCommand, isWholeCommand, canOwnRemainder);
  }
  if (program === "powershell" || program === "pwsh") {
    return unwrapPowerShell(args, joinedBy, rawCommand, canOwnRemainder);
  }
  return { kind: "none" };
}

function programTokens(tokens: readonly Token[]): readonly Token[] {
  const skip = tokens.length - programWords(tokens.map((t) => t.value)).length;
  return tokens.slice(skip);
}

function resolveProgram(
  rawFirst: Token,
  args: readonly Token[],
  winDialect: boolean,
): { program: string; args: readonly Token[] } {
  const word = rawFirst.value;
  if (winDialect) {
    const gluedProg = CMD_GLUED_PROGRAM.exec(word);
    if (gluedProg !== null) {
      const switchText = gluedProg[2] as string;
      const switchToken: Token = {
        value: switchText,
        unquotedCommas: [],
        start: rawFirst.start + (gluedProg[1] as string).length,
        end: rawFirst.end,
      };
      return { program: (gluedProg[1] as string).toLowerCase(), args: [switchToken, ...args] };
    }
  }
  return { program: basename(word), args };
}

function checkSegment(
  segment: RichSegment,
  ctx: PathContext,
  here: string | null,
  depth: number,
  dialect: ShellDialect,
  rawCommand: string,
  isWholeCommand: boolean,
  canOwnRemainder: boolean,
): boolean {
  const tokens = programTokens(segment.tokens);
  if (tokens.length === 0) return false;

  const isWin =
    dialect === "cmd" ||
    dialect === "powershell" ||
    isWinPath(ctx.cwd) ||
    isWinPath(ctx.home) ||
    (here !== null && isWinPath(here));

  const firstToken = tokens[0] as Token;
  const { program, args } = resolveProgram(firstToken, tokens.slice(1), isWin);
  const argValues = args.map((t) => t.value);

  if (
    /%[^%\s]+%|\$/.test(firstToken.value) &&
    program !== "%comspec%" &&
    (DELETE_KEYWORD.test(argValues.join(" ")) ||
      argValues.some((w) => /^\/[ck]$/i.test(w) || /^-(?:command|c)$/i.test(w)))
  ) {
    return true;
  }

  const inner = unwrapWindowsShell(
    program,
    args,
    segment.joinedBy,
    rawCommand,
    isWholeCommand,
    canOwnRemainder,
  );
  if (inner.kind === "escalate") return true;
  if (inner.kind === "text") {
    const subHere =
      inner.dir !== undefined
        ? here === null
          ? null
          : resolveWord(inner.dir, { ...ctx, cwd: here })
        : here;
    return checkCommandText(inner.text, ctx, subHere, depth + 1, inner.dialect);
  }

  if (DELETE_PROGRAMS.has(program) || program === "trash") {
    const isPowerShell = dialect === "powershell" || program === "remove-item" || program === "ri";
    if (isPowerShell && segment.joinedBy === "|") return true;
    const allowCmdSwitches = CMD_STYLE_DELETERS.has(program) && isWin;
    const splitCommas = isWin || isPowerShell;
    const { targets, unknown } = rmTargets(
      args,
      rawCommand,
      allowCmdSwitches,
      splitCommas,
      isPowerShell,
    );
    if (unknown) return true;
    if (segment.joinedBy === "|" && targets.length === 0) return true;
    if (targets.length > 0 && here === null) return true;
    if (here !== null && targets.some((t) => isWide(t, ctx, here))) return true;
  }

  if (program === "xargs") {
    const innerCmd = programWords(argValues.filter((w) => !w.startsWith("-")));
    if (DELETE_PROGRAMS.has(basename(innerCmd[0] ?? ""))) return true;
  }

  if (program === "find") {
    // `find . -name '*.tmp' -delete` picks files by name; without a filter it empties a folder.
    const filtered = argValues.some((w) => /^-i?(name|path|regex|wholename)$/.test(w));
    const deletes =
      !filtered &&
      (argValues.includes("-delete") ||
        argValues.some(
          (w, i) =>
            (w === "-exec" || w === "-execdir") &&
            DELETE_PROGRAMS.has(basename(argValues[i + 1] ?? "")),
        ));
    if (deletes) return true;
  }

  return false;
}

function hasUnquotedBrace(text: string): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble && c === "{") return true;
  }
  return false;
}

function dedupeHeres(list: readonly (string | null)[]): (string | null)[] {
  const out: (string | null)[] = [];
  for (const h of list) {
    if (!out.includes(h)) out.push(h);
  }
  return out.length > 8 ? [null] : out;
}

function checkCommandText(
  command: string,
  ctx: PathContext,
  initialHere: string | null,
  depth: number,
  dialect: ShellDialect = "default",
): boolean {
  if (command.trim() === "") return false;
  if (depth > MAX_SHELL_DEPTH) return true;

  // PowerShell blocks (`{ ... }`, `if (...) { ... }`) can change scope or control flow internally.
  if (
    (dialect === "powershell" || isWinPath(ctx.cwd)) &&
    hasUnquotedBrace(command) &&
    DELETE_KEYWORD.test(command)
  ) {
    return true;
  }

  let segments: RichSegment[];
  try {
    segments = splitCommandRich(command);
  } catch (error) {
    // A command we cannot read may delete anything; ask when it mentions a delete or opaque wrapper.
    if (error instanceof UnparsedCommandError) return DELETE_KEYWORD.test(command);
    throw error;
  }

  // Track active working directories and fallbacks when a `cd`/`Set-Location` might fail before `;`.
  let activeHeres: (string | null)[] = [initialHere];
  let failHeres: (string | null)[] = [];

  for (let idx = 0; idx < segments.length; idx++) {
    const segment = segments[idx] as RichSegment;
    if (segment.joinedBy === "||") {
      activeHeres = failHeres.length > 0 ? failHeres : activeHeres;
      failHeres = [];
    } else if (segment.joinedBy === ";" || segment.joinedBy === "&" || segment.joinedBy === "\n") {
      activeHeres = dedupeHeres([...activeHeres, ...failHeres]);
      failHeres = [];
    }

    const tokens = programTokens(segment.tokens);
    const program = basename(tokens[0]?.value ?? "");

    if (CD_PROGRAMS.has(program)) {
      const target = cdTarget(tokens.slice(1).map((t) => t.value));
      failHeres = dedupeHeres([...failHeres, ...activeHeres]);
      activeHeres = dedupeHeres(
        activeHeres.map((h) =>
          h === null || target === null ? null : resolveWord(target, { ...ctx, cwd: h }),
        ),
      );
      continue;
    }

    if (POP_CD_PROGRAMS.has(program)) {
      failHeres = dedupeHeres([...failHeres, ...activeHeres]);
      activeHeres = [null];
      continue;
    }

    const isWholeCommand = idx === 0 && segments.length === 1;
    const canOwnRemainder =
      idx === 0 &&
      (program === "cmd" ||
        program === "%comspec%" ||
        program === "powershell" ||
        program === "pwsh");
    for (const here of activeHeres) {
      if (
        checkSegment(segment, ctx, here, depth, dialect, command, isWholeCommand, canOwnRemainder)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Whether an agent request deletes a lot at once. */
export function massDeleteCheck(call: ToolCallInfo, ctx: PathContext): GuardResult {
  if (call.kind === "delete" && call.paths.some((p) => isWide(p, ctx))) return HIT;
  if (call.command === undefined || call.command.trim() === "") return MISS;
  return checkCommandText(call.command, ctx, ctx.cwd, 0) ? HIT : MISS;
}
