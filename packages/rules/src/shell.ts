// A small, conservative shell splitter. It understands quotes, escapes and the control
// operators that join commands. Anything it cannot read with confidence (command or process
// substitution, unbalanced quotes) throws `UnparsedCommandError`, so callers fail toward the
// human.

export class UnparsedCommandError extends Error {
  constructor(reason: string) {
    super(`unparsed: ${reason}`);
    this.name = "UnparsedCommandError";
  }
}

export type JoinOperator = "&&" | "||" | ";" | "|" | "&" | "\n";

export interface Segment {
  /** Operator that joins this segment to the previous one; `null` for the first. */
  joinedBy: JoinOperator | null;
  /** Words with quotes removed. Redirection operators are separate words (`>`, `>>`, `<`). */
  words: string[];
}

const OPERATORS: readonly JoinOperator[] = ["&&", "||", ";", "|", "&", "\n"];

/** Split a command line into segments joined by control operators. */
export function splitCommand(input: string): Segment[] {
  const segments: Segment[] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let joinedBy: JoinOperator | null = null;
  let i = 0;

  const endWord = (): void => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endSegment = (op: JoinOperator): void => {
    endWord();
    if (words.length === 0) {
      if (op === "\n" || op === ";") return; // blank line or trailing `;`
      throw new UnparsedCommandError(`empty command before ${JSON.stringify(op)}`);
    }
    segments.push({ joinedBy, words });
    words = [];
    joinedBy = op;
  };

  while (i < input.length) {
    const c = input[i] as string;
    const next = input[i + 1];

    if (c === "\\") {
      if (next === undefined) throw new UnparsedCommandError("trailing backslash");
      if (next !== "\n") {
        word += next;
        inWord = true;
      }
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new UnparsedCommandError("unbalanced single quote");
      word += input.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i += 1;
      let closed = false;
      while (i < input.length) {
        const d = input[i] as string;
        if (d === '"') {
          closed = true;
          i += 1;
          break;
        }
        if (d === "`" || (d === "$" && input[i + 1] === "(")) {
          throw new UnparsedCommandError("command substitution");
        }
        if (d === "\\" && i + 1 < input.length) {
          word += input[i + 1];
          i += 2;
          continue;
        }
        word += d;
        i += 1;
      }
      if (!closed) throw new UnparsedCommandError("unbalanced double quote");
      inWord = true;
      continue;
    }
    if (c === "`" || (c === "$" && next === "(")) {
      throw new UnparsedCommandError("command substitution");
    }
    if ((c === "<" || c === ">") && next === "(") {
      throw new UnparsedCommandError("process substitution");
    }
    if (c === " " || c === "\t") {
      endWord();
      i += 1;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      endSegment(two);
      i += 2;
      continue;
    }
    if (two === "|&") {
      endSegment("|");
      i += 2;
      continue;
    }
    if (c === ">" || c === "<") {
      // Redirections become their own words: `2>` `>>` `>` `<` `&>`.
      const fd = inWord && /^\d+$/.test(word) ? word : "";
      if (fd !== "") {
        word = "";
        inWord = false;
      } else {
        endWord();
      }
      let op = fd + c;
      i += 1;
      if (input[i] === c) {
        op += c;
        i += 1;
      }
      if (input[i] === "&") {
        op += "&";
        i += 1;
      }
      words.push(op);
      continue;
    }
    if (c === "&" && next === ">") {
      endWord();
      const append = input[i + 2] === ">";
      words.push(append ? "&>>" : "&>");
      i += append ? 3 : 2;
      continue;
    }
    if ((OPERATORS as readonly string[]).includes(c)) {
      endSegment(c as JoinOperator);
      i += 1;
      continue;
    }
    word += c;
    inWord = true;
    i += 1;
  }

  endWord();
  if (words.length > 0) segments.push({ joinedBy, words });
  else if (joinedBy !== null && joinedBy !== ";" && joinedBy !== "&" && joinedBy !== "\n") {
    throw new UnparsedCommandError(`missing command after ${JSON.stringify(joinedBy)}`);
  }
  return segments;
}

const WRAPPERS = new Set([
  "sudo",
  "doas",
  "command",
  "builtin",
  "exec",
  "nice",
  "nohup",
  "time",
  "env",
]);

/**
 * The words of a segment starting at the real program: leading `NAME=value` assignments and
 * wrappers such as `sudo`, `env`, `nohup` are skipped. Options of the wrappers are skipped too
 * (coarse: every word starting with `-` right after a wrapper).
 */
export function programWords(words: readonly string[]): string[] {
  let i = 0;
  while (i < words.length) {
    const w = words[i] as string;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      i += 1;
      continue;
    }
    if (WRAPPERS.has(basename(w))) {
      i += 1;
      while (i < words.length && (words[i] as string).startsWith("-")) i += 1;
      continue;
    }
    break;
  }
  return words.slice(i);
}

export function basename(word: string): string {
  const slash = word.lastIndexOf("/");
  return slash === -1 ? word : word.slice(slash + 1);
}
