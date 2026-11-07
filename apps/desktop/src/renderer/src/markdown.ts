// A small Markdown reader for what agents write: headings, paragraphs, lists, quotes, fenced
// code, tables, rules and inline code, bold, italic, strikethrough and links. It returns plain
// data, never HTML, so the renderer builds React elements and agent text cannot inject markup.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em" | "del"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "break" };

export type ListItem = { text: string; checked?: boolean; children: Block[] };

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "quote"; children: Block[] }
  | { kind: "table"; align: Align[]; head: string[]; rows: string[][] }
  | { kind: "rule" };

export type Align = "left" | "center" | "right" | undefined;

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Splits Markdown text into blocks. */
export function parseMarkdown(text: string): Block[] {
  return blocks(text.replace(/\r\n?/g, "\n").split("\n"));
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence !== null) {
      const mark = fence[1] ?? "```";
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith(mark))
        body.push(lines[i++] ?? "");
      i++;
      out.push({ kind: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      out.push({ kind: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ kind: "rule" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim() !== "") {
        const q = QUOTE.exec(lines[i] ?? "");
        body.push(q === null ? (lines[i] ?? "") : (q[1] ?? ""));
        i++;
      }
      out.push({ kind: "quote", children: blocks(body) });
      continue;
    }
    if (ITEM.test(line)) {
      i = list(lines, i, out);
      continue;
    }
    if (
      line.includes("|") &&
      TABLE_SEP.test(lines[i + 1] ?? "") &&
      (lines[i + 1] ?? "").includes("-")
    ) {
      const head = cells(line);
      const align = cells(lines[i + 1] ?? "").map(alignOf);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") {
        rows.push(cells(lines[i] ?? ""));
        i++;
      }
      out.push({ kind: "table", align, head, rows });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !startsBlock(lines, i)) para.push(lines[i++] ?? "");
    out.push({ kind: "paragraph", text: para.join("\n") });
  }
  return out;
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i] ?? "";
  return (
    line.trim() === "" ||
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    ITEM.test(line)
  );
}

/** Reads one list starting at `start`; nested lines (deeper indent) become the item's blocks. */
function list(lines: string[], start: number, out: Block[]): number {
  const first = ITEM.exec(lines[start] ?? "");
  const indent = first?.[1]?.length ?? 0;
  const ordered = /\d/.test(first?.[2] ?? "");
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i] ?? "");
    if (m === null || (m[1]?.length ?? 0) !== indent || /\d/.test(m[2] ?? "") !== ordered) break;
    let text = m[3] ?? "";
    let checked: boolean | undefined;
    const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
    if (task !== null) {
      checked = task[1] !== " ";
      text = task[2] ?? "";
    }
    const more: string[] = [];
    const nested: string[] = [];
    i++;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim() === "") {
        // A blank line ends the list unless an indented line follows.
        if (/^\s+\S/.test(lines[i + 1] ?? "") && indentOf(lines[i + 1] ?? "") > indent) {
          nested.push("");
          i++;
          continue;
        }
        break;
      }
      const depth = indentOf(next);
      if (depth > indent) nested.push(next.slice(Math.min(depth, indent + 2)));
      else if (ITEM.test(next) || startsBlock(lines, i)) break;
      else if (nested.length === 0) more.push(next.trim());
      else break;
      i++;
    }
    if (more.length > 0) text = [text, ...more].join("\n");
    items.push({ text, checked, children: blocks(nested) });
  }
  out.push({ kind: "list", ordered, start: Number.parseInt(first?.[2] ?? "1", 10) || 1, items });
  return i;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return undefined;
}

const SAFE_HREF = /^(https?:|mailto:)/i;

/** Reads inline Markdown. Links that are not http(s) or mailto stay plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain !== "") out.push({ kind: "text", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const ch = text[i] ?? "";
    if (ch === "\\" && /^\\[\\`*_~[\]()#|>!-]/.test(rest)) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push({ kind: "break" });
      i++;
      continue;
    }
    if (ch === "`") {
      const ticks = /^`+/.exec(rest)?.[0] ?? "`";
      const end = text.indexOf(ticks, i + ticks.length);
      if (end > 0) {
        flush();
        out.push({ kind: "code", text: text.slice(i + ticks.length, end).trim() || " " });
        i = end + ticks.length;
        continue;
      }
    }
    const link = /^\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
    if (link !== null && SAFE_HREF.test(link[2] ?? "")) {
      flush();
      out.push({ kind: "link", href: link[2] ?? "", children: parseInline(link[1] ?? "") });
      i += link[0].length;
      continue;
    }
    const auto = /^https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"，。；：！？、）】]/.exec(rest);
    if (auto !== null && !/[\w/]$/.test(text.slice(0, i))) {
      flush();
      out.push({ kind: "link", href: auto[0], children: [{ kind: "text", text: auto[0] }] });
      i += auto[0].length;
      continue;
    }
    const emph = emphasis(text, i);
    if (emph !== undefined) {
      flush();
      out.push(emph.node);
      i = emph.end;
      continue;
    }
    plain += ch;
    i++;
  }
  flush();
  return out;
}

function emphasis(text: string, i: number): { node: Inline; end: number } | undefined {
  for (const [mark, kind] of [
    ["**", "strong"],
    ["__", "strong"],
    ["~~", "del"],
    ["*", "em"],
    ["_", "em"],
  ] as const) {
    if (!text.startsWith(mark, i)) continue;
    const open = i + mark.length;
    if (/\s/.test(text[open] ?? " ")) continue;
    // `_` inside words (snake_case) is not emphasis.
    if (mark[0] === "_" && /\w/.test(text[i - 1] ?? "")) continue;
    let end = text.indexOf(mark, open + 1);
    while (end > 0) {
      const closesWord = mark[0] !== "_" || !/\w/.test(text[end + mark.length] ?? "");
      if (
        !/\s/.test(text[end - 1] ?? "") &&
        closesWord &&
        text.slice(open, end).indexOf("\n\n") < 0
      ) {
        return {
          node: { kind, children: parseInline(text.slice(open, end)) },
          end: end + mark.length,
        };
      }
      end = text.indexOf(mark, end + 1);
    }
  }
  return undefined;
}

/** The text of inline Markdown without its marks, for one-line previews. */
export function plainText(text: string): string {
  const flat = (nodes: Inline[]): string =>
    nodes
      .map((n) => {
        if (n.kind === "text" || n.kind === "code") return n.text;
        if (n.kind === "break") return " ";
        return flat(n.children);
      })
      .join("");
  return parseMarkdown(text)
    .map((b) => {
      if (b.kind === "code") return b.text;
      if (b.kind === "heading" || b.kind === "paragraph") return flat(parseInline(b.text));
      if (b.kind === "list") return b.items.map((it) => flat(parseInline(it.text))).join(" ");
      if (b.kind === "quote")
        return b.children.map((c) => ("text" in c ? flat(parseInline(c.text)) : "")).join(" ");
      if (b.kind === "table") return b.head.join(" ");
      return "";
    })
    .filter((s) => s !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
