// The Herder's context (ADR 0045): the whole conversation is kept, and the model folds parts it no
// longer needs into summaries it writes itself. The engine is our fork of billion-context's
// acp-kernel (packages/context-kernel); this file adapts it to the Herder's pi messages.

import {
  blockDocs,
  buildCompressSystemPrompt,
  buildStatusReport,
  COMPRESS_TOOL_OPENAI,
  type CompressionState,
  type Config,
  type CoreMessage,
  collectBlockContent,
  coveredMessageIds,
  createCore,
  createInitialState,
  defaultConfig,
  defaultCountTokens,
  type MessageInput,
  messageDocs,
  type Prompts,
  parseBlockIdArg,
  parseCompressArgs,
  prune,
  rebuildCompressionState,
  renderNudgeText,
  resolvePrompts,
  searchBlocks,
} from "@agentherd/context-kernel";
import type { AgentMessage, AgentTool, AgentToolResult } from "@agentherd/herder-loop";
import { bool, int, obj, opt, str } from "@earendil-works/pi-schema";
import { OWNER_LABEL } from "./prompt.ts";

/** Where the folds and refs are saved; the messages themselves are in `herder_log`. */
export const CONTEXT_STATE_KEY = "herder.context";
/**
 * The window the Herder works in: the model's, but at most this, and this when the model does not
 * say. Every request sends the whole view, and a chat with the owner needs no more.
 */
export const CONTEXT_WINDOW_MAX = 128_000;
/** At this share of the window, unfolded old messages are folded without waiting for the model… */
export const FORCED_FOLD_AT = 0.9;
/** …until the context is down to about this share. */
export const FORCED_FOLD_TO = 0.6;
/** Characters one decompress returns; the rest is cut with a note. */
export const DECOMPRESS_MAX_CHARS = 60_000;
/** These tools change only what the model sees, so a turn that used them may run again. */
export const CONTEXT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "compress",
  "decompress",
  "search_context",
  "acp_status",
]);

const ID = /^h(\d+)(?:#(\d+))?$/;
/** Echoed ref tags; the model is told never to write them, this catches the slips. */
const TAG = /<acp\b[^>]*>[^<]*<\/acp>\n?/g;
const MESSAGE_OVERHEAD = 4;

type Content = string | readonly { type: string; text?: string }[];

export interface ContextHooks {
  /** The current model's context window in tokens; 0 when unknown. */
  contextWindow(): number;
  /** The agent's messages now, the leading system message included. */
  messages(): readonly AgentMessage[];
  audit(type: string, data: Record<string, unknown>): void;
}

/** Removes ref tags the model copied into text meant for people or agents. */
export function withoutContextMarks(text: string): string {
  return text.replace(TAG, "");
}

/** `value` with ref tags removed from every string in it. */
export function withoutMarksDeep<T>(value: T): T {
  if (typeof value === "string") return withoutContextMarks(value) as T;
  if (Array.isArray(value)) return value.map((v) => withoutMarksDeep(v)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutMarksDeep(v)])) as T;
  }
  return value;
}

/** How many system messages lead the agent's messages (the prompt and tools); they are not logged. */
export function leadingSystem(messages: readonly AgentMessage[]): number {
  let n = 0;
  while (messages[n]?.role === "system") n++;
  return n;
}

/** The first position where `log` differs from what was saved. */
export function changedFrom(saved: readonly AgentMessage[], log: readonly AgentMessage[]): number {
  const n = Math.min(saved.length, log.length);
  let i = 0;
  while (i < n && saved[i] === log[i]) i++;
  return i;
}

function textOf(content: Content): string {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

function idOf(index: number, part: number): string {
  return part === 0 ? `h${index}` : `h${index}#${part}`;
}

function indexOf(id: string): number {
  return Number(ID.exec(id)?.[1] ?? Number.NaN);
}

/**
 * The kernel keeps the first user message in view for good (it heads the prompt cache, and strict
 * providers want a user message). This fixed line takes that place, so the owner's first message
 * can be folded like any other.
 */
export const OPENING_TEXT =
  "[Start of the conversation with the owner. AgentHerd keeps all of it; folded parts show as summaries.]";

/**
 * The kernel's view of the log: the opening line, then one core message per text, thought, tool
 * call or result. Ids are positions in the log, which only grows, so they stay the same across
 * turns and restarts.
 */
export function toCore(log: readonly AgentMessage[]): CoreMessage[] {
  const out: CoreMessage[] = [
    { id: "opening", role: "user", contentType: "text", text: OPENING_TEXT },
  ];
  log.forEach((m, i) => {
    switch (m.role) {
      case "user":
        out.push({ id: idOf(i, 0), role: "user", contentType: "text", text: textOf(m.content) });
        return;
      case "toolResult":
        out.push({
          id: idOf(i, 0),
          role: "tool",
          contentType: "tool-result",
          toolName: m.toolName,
          toolCallId: m.toolCallId,
          text: textOf(m.content),
        });
        return;
      case "assistant":
        if (m.content.length === 0) {
          out.push({ id: idOf(i, 0), role: "assistant", contentType: "text", text: "" });
          return;
        }
        m.content.forEach((part, k) => {
          const id = idOf(i, k);
          if (part.type === "text") {
            out.push({ id, role: "assistant", contentType: "text", text: part.text });
          } else if (part.type === "thinking") {
            out.push({ id, role: "assistant", contentType: "reasoning", text: part.thinking });
          } else {
            out.push({
              id,
              role: "assistant",
              contentType: "tool-call",
              toolName: part.name,
              toolCallId: part.id,
              text: JSON.stringify(part.arguments),
            });
          }
        });
        return;
      default:
        out.push({ id: idOf(i, 0), role: "system", contentType: "text", text: textOf(m.content) });
    }
  });
  return out;
}

/** A note in the request only (a summary, a nudge); never saved. */
function note(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: 0 };
}

/** The message with its text replaced by the kernel's (a ref tag in front, or cut down). */
function withText(m: AgentMessage, text: string): AgentMessage {
  if (m.role === "user") {
    if (text === textOf(m.content)) return m;
    if (typeof m.content === "string") return { ...m, content: text };
    return {
      ...m,
      content: [{ type: "text", text }, ...m.content.filter((c) => c.type !== "text")],
    };
  }
  if (m.role === "toolResult") {
    if (text === textOf(m.content)) return m;
    return {
      ...m,
      content: [{ type: "text", text }, ...m.content.filter((c) => c.type !== "text")],
    };
  }
  return m;
}

function rebuild(
  m: AgentMessage,
  parts: ReadonlyMap<number, CoreMessage>,
): AgentMessage | undefined {
  if (m.role !== "assistant") {
    const core = parts.get(0);
    if (core === undefined) return undefined;
    return withText(m, core.text ?? "");
  }
  if (m.content.length === 0) return parts.has(0) ? m : undefined;
  let same = true;
  const content: typeof m.content = [];
  m.content.forEach((part, k) => {
    const core = parts.get(k);
    if (core === undefined) {
      same = false;
    } else if (part.type !== "text" || core.text === undefined || core.text === part.text) {
      // Tool calls and thoughts go as they were: their arguments and signatures must not change.
      content.push(part);
    } else {
      same = false;
      content.push({ ...part, text: core.text });
    }
  });
  if (content.length === 0) return undefined;
  return same ? m : { ...m, content };
}

/** Drops tool results without their call and calls without their result: providers refuse both. */
function paired(messages: AgentMessage[]): AgentMessage[] {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const m of messages) {
    if (m.role === "toolResult") results.add(m.toolCallId);
    if (m.role === "assistant") {
      for (const part of m.content) if (part.type === "toolCall") calls.add(part.id);
    }
  }
  return messages.flatMap((m): AgentMessage[] => {
    if (m.role === "toolResult") return calls.has(m.toolCallId) ? [m] : [];
    if (m.role !== "assistant") return [m];
    const content = m.content.filter((p) => p.type !== "toolCall" || results.has(p.id));
    if (content.length === m.content.length) return [m];
    return content.length === 0 ? [] : [{ ...m, content }];
  });
}

/** Back from the kernel's view to pi messages; summaries and notes become user messages. */
export function fromCore(
  view: readonly CoreMessage[],
  log: readonly AgentMessage[],
): AgentMessage[] {
  const out: AgentMessage[] = [];
  const done = new Set<number>();
  let i = 0;
  while (i < view.length) {
    const first = view[i] as CoreMessage;
    const index = indexOf(first.id);
    if (Number.isNaN(index)) {
      if (first.text !== undefined && first.text !== "") out.push(note(first.text));
      i++;
      continue;
    }
    const parts = new Map<number, CoreMessage>();
    for (; i < view.length; i++) {
      const core = view[i] as CoreMessage;
      if (indexOf(core.id) !== index) break;
      parts.set(Number(ID.exec(core.id)?.[2] ?? 0), core);
    }
    const original = log[index];
    if (original === undefined || done.has(index)) continue;
    done.add(index);
    const rebuilt = rebuild(original, parts);
    if (rebuilt !== undefined) out.push(rebuilt);
  }
  return paired(out);
}

function estimate(view: readonly CoreMessage[]): number {
  let total = 0;
  for (const m of view) total += defaultCountTokens(m.text ?? "") + MESSAGE_OVERHEAD;
  return total;
}

/** The owner's own words in a Herder prompt: without the time line, events or recalled memory. */
function ownerWords(text: string): string {
  const at = text.indexOf(OWNER_LABEL);
  const rest =
    at === -1 ? text.replace(/^\[Now: [^\]]*\]\s*/, "") : text.slice(at + OWNER_LABEL.length);
  const end = rest.indexOf("\n\n[");
  return end === -1 ? rest : rest.slice(0, end);
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function ok(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

/** What a fold without the model's summary says, so the folded part is not a blank. */
export function forcedSummary(log: readonly AgentMessage[], from: number, to: number): string {
  const asks: string[] = [];
  for (let i = from; i <= to; i++) {
    const m = log[i];
    if (m?.role === "user") asks.push(`- ${oneLine(ownerWords(textOf(m.content)), 160)}`);
  }
  return [
    "Folded without a summary because the context was nearly full. Nothing is lost: search_context finds these messages and decompress shows them.",
    ...(asks.length === 0
      ? []
      : ["Owner messages in this part (start of each):", ...asks.slice(-20)]),
  ].join("\n");
}

export class HerderContext {
  private readonly core = createCore();
  private readonly prompts: Prompts = resolvePrompts(undefined, { languagePreservation: true });
  private readonly hooks: ContextHooks;
  state: CompressionState;
  /** Tokens of the last request, for the status report. */
  private lastTokens = 0;

  constructor(hooks: ContextHooks, log: readonly AgentMessage[], saved?: CompressionState) {
    this.hooks = hooks;
    this.state = saved ?? createInitialState();
    if (saved === undefined && log.length > 0) {
      // The folds are lost but the compress calls are in the log: replay them.
      try {
        this.state = rebuildCompressionState(this.state, toCore(log), this.config()).state;
      } catch (error) {
        hooks.audit("herder.context.error", {
          during: "rebuild",
          message: (error as Error).message,
        });
      }
    }
  }

  /** Compression rules for the system prompt (billion-context's, unchanged). */
  systemPrompt(): string {
    return buildCompressSystemPrompt(this.prompts);
  }

  private config(): Config {
    const window = this.hooks.contextWindow();
    return defaultConfig(window > 0 ? Math.min(window, CONTEXT_WINDOW_MAX) : CONTEXT_WINDOW_MAX);
  }

  private log(): AgentMessage[] {
    const messages = this.hooks.messages();
    return messages.slice(leadingSystem(messages));
  }

  /**
   * Builds what the model sees (`transformContext`): folded parts become their summaries, every
   * message gets a ref tag, and a nudge to fold is added when the context has grown. Should the
   * engine fail, the newest whole turns that fit half the window go instead, so the Herder still
   * answers.
   */
  project(messages: readonly AgentMessage[]): AgentMessage[] {
    try {
      return this.view(messages);
    } catch (error) {
      this.hooks.audit("herder.context.error", {
        during: "project",
        message: (error as Error).message,
      });
      return this.tail(messages);
    }
  }

  private tail(messages: readonly AgentMessage[]): AgentMessage[] {
    const lead = leadingSystem(messages);
    const budget = this.config().modelContextLimit * 0.5;
    let start = messages.length;
    let tokens = 0;
    for (let i = messages.length - 1; i >= lead; i--) {
      const m = messages[i] as AgentMessage;
      tokens += defaultCountTokens(JSON.stringify(m)) + MESSAGE_OVERHEAD;
      if (tokens > budget && start < messages.length) break;
      if (m.role === "user") start = i;
    }
    return paired([
      ...messages.slice(0, lead),
      ...messages.slice(start === messages.length ? lead : start),
    ]);
  }

  private view(messages: readonly AgentMessage[]): AgentMessage[] {
    const lead = leadingSystem(messages);
    const head = messages.slice(0, lead);
    const log = messages.slice(lead);
    const core = toCore(log);
    const config = this.config();
    const fixed = defaultCountTokens(JSON.stringify(head));
    const run = () => {
      const tokenCount = fixed + estimate(prune(core, this.state));
      const turn = this.core.processTurn({
        messages: core,
        state: this.state,
        config,
        tokenCount,
        tokenCountSource: "estimate",
      });
      this.state = turn.state;
      return { turn, tokens: fixed + estimate(turn.messages) };
    };
    let { turn, tokens } = run();
    const window = config.modelContextLimit;
    if (
      tokens >= window * FORCED_FOLD_AT &&
      this.fold(core, log, config, tokens - window * FORCED_FOLD_TO)
    ) {
      ({ turn, tokens } = run());
    }
    this.lastTokens = tokens;
    if (turn.terminalEscape !== undefined) {
      this.hooks.audit("herder.context.full", { message: turn.terminalEscape.message });
    }
    const out = [...head, ...fromCore(turn.messages, log)];
    if (turn.nudge?.shouldInject) {
      const text = renderNudgeText(turn.nudge, this.prompts).text;
      if (text !== "") out.push(note(text));
    }
    if (turn.statusLine !== undefined) out.push(note(turn.statusLine));
    return out;
  }

  /**
   * The last resort: folds the oldest unfolded messages with a plain note instead of a summary,
   * whole turns at a time, until about `excess` tokens are folded. The current turn is never
   * folded. @returns whether anything was folded.
   */
  fold(
    core: readonly CoreMessage[],
    log: readonly AgentMessage[],
    config: Config,
    excess: number,
  ): boolean {
    const covered = new Set([...coveredMessageIds(this.state)].map((id) => id.split("#")[0]));
    let end = log.length;
    while (end > 0 && log[end - 1]?.role !== "user") end--;
    end--; // The owner message of the current turn stays, with everything after it.
    const refs = this.state.messageRefs.byRaw;
    const tokensOf = new Map<number, number>();
    for (const c of core) {
      const index = indexOf(c.id);
      tokensOf.set(
        index,
        (tokensOf.get(index) ?? 0) + defaultCountTokens(c.text ?? "") + MESSAGE_OVERHEAD,
      );
    }
    const lastId = (index: number) => {
      const m = log[index];
      const parts = m?.role === "assistant" ? Math.max(m.content.length, 1) : 1;
      return idOf(index, parts - 1);
    };
    const free = (index: number) => index < end && !covered.has(idOf(index, 0));
    const ranges: { startRef: string; endRef: string; summary: string }[] = [];
    let folded = 0;
    for (let i = 0; i < end && folded < excess; ) {
      if (!free(i)) {
        i++;
        continue;
      }
      const from = i;
      let tokens = 0;
      while (free(i) && folded + tokens < excess) {
        tokens += tokensOf.get(i) ?? 0;
        i++;
      }
      // Whole turns: go on to the next owner message so tool calls keep their results.
      while (free(i) && log[i]?.role !== "user") {
        tokens += tokensOf.get(i) ?? 0;
        i++;
      }
      const startRef = refs[idOf(from, 0)];
      const endRef = refs[lastId(i - 1)];
      if (startRef === undefined || endRef === undefined) continue;
      ranges.push({ startRef, endRef, summary: forcedSummary(log, from, i - 1) });
      folded += tokens;
    }
    if (ranges.length === 0) return false;
    const result = this.core.applyCompression({
      ranges,
      messages: [...core],
      state: this.state,
      // The size floor keeps the model from folding crumbs; a forced fold of a small window is fine.
      config: { ...config, compress: { ...config.compress, minCompressRange: 0 } },
    });
    this.hooks.audit("herder.context.forced-fold", {
      ranges: ranges.map((r) => `${r.startRef}–${r.endRef}`),
      blocks: result.result.blocksCreated,
      errors: result.result.errors,
    });
    if (result.result.blocksCreated === 0) return false;
    this.state = result.state;
    return true;
  }

  /**
   * After the provider said the request was too long: folds the oldest unfolded messages so about
   * half the window is free. @returns whether anything was folded.
   */
  foldForOverflow(): boolean {
    const messages = this.hooks.messages();
    const lead = leadingSystem(messages);
    const log = messages.slice(lead);
    try {
      const core = toCore(log);
      const config = this.config();
      const tokens =
        defaultCountTokens(JSON.stringify(messages.slice(0, lead))) +
        estimate(prune(core, this.state));
      const excess = Math.max(tokens - config.modelContextLimit * 0.5, tokens / 2);
      return this.fold(core, log, config, excess);
    } catch (error) {
      this.hooks.audit("herder.context.error", {
        during: "overflow",
        message: (error as Error).message,
      });
      return false;
    }
  }

  /** Forgets token counts of messages from `from` on, after a failed turn was taken back. */
  rollback(from: number): void {
    const snapshot = { ...this.state.tokenSnapshot };
    for (const [raw, ref] of Object.entries(this.state.messageRefs.byRaw)) {
      if (indexOf(raw) >= from) delete snapshot[ref];
    }
    this.state = { ...this.state, tokenSnapshot: snapshot };
  }

  tools(): AgentTool[] {
    return [this.compressTool(), this.decompressTool(), this.searchTool(), this.statusTool()];
  }

  private compressTool(): AgentTool {
    const fn = COMPRESS_TOOL_OPENAI.function;
    return {
      name: "compress",
      label: "Fold old conversation",
      description: fn.description,
      parameters: obj(
        { content: opt(str({ description: fn.parameters.properties.content.description })) },
        { open: true },
      ),
      execute: async (callId: string, args: Record<string, unknown>) => {
        const parsed = parseCompressArgs(args, { callId });
        if (parsed.ranges.length === 0) {
          throw new Error(
            "no ranges found: content must hold blocks that each start with a 'mNNNNN–mNNNNN topic' line",
          );
        }
        const result = this.core.applyCompression({
          ranges: parsed.ranges.map((r) => ({ ...r, compressCallId: callId })),
          messages: toCore(this.log()),
          state: this.state,
          config: this.config(),
        });
        const r = result.result;
        this.hooks.audit("herder.context.compress", {
          ranges: parsed.ranges.map((x) => `${x.startRef}–${x.endRef}`),
          blocks: r.blocksCreated,
          tokens: r.tokensCompressed,
          errors: r.errors,
        });
        const notes = [...r.warnings, ...(r.notes ?? [])].map((n) => `Note: ${n}`);
        if (r.blocksCreated === 0) {
          // Already folded or among the newest messages: a receipt, so the model does not retry.
          if (r.noop === true) {
            return ok(
              [
                "[Compression no-op: nothing in these ranges needed folding. They are already folded or among the newest messages, which stay as they are.]",
                ...notes,
              ].join("\n"),
            );
          }
          throw new Error([...r.errors, ...notes].join("; ") || "nothing was compressed");
        }
        this.state = result.state;
        const lines = [
          `Compressed ${r.blocksCreated} block(s), about ${r.tokensCompressed} tokens folded.`,
          ...r.errors.map((e) => `Not compressed: ${e}`),
          ...notes,
        ];
        return ok(lines.join("\n"));
      },
    } as AgentTool;
  }

  private decompressTool(): AgentTool {
    return {
      name: "decompress",
      label: "Read a folded part",
      description:
        "Shows the content of a compressed block without unfolding it. Use when you need exact details lost in compression. By default restores one tier up (nested blocks stay as their summaries); full:true shows every original message.",
      parameters: obj(
        {
          blockId: str({ description: "Block ID to decompress (e.g. b5)" }),
          full: opt(bool({ description: "Restore all the way to original messages" })),
        },
        { open: true },
      ),
      execute: async (_id: string, args: { blockId: string; full?: boolean }) => {
        const blockId = parseBlockIdArg(args.blockId);
        const block = this.state.blocks.find((b) => b.blockId === blockId);
        if (block === undefined) {
          const known = this.state.blocks.filter((b) => b.active).map((b) => b.blockId);
          throw new Error(`no block ${args.blockId}; active blocks: ${known.join(", ") || "none"}`);
        }
        const { text, count } = collectBlockContent(this.state, block, toCore(this.log()), {
          full: args.full === true,
        });
        const cut =
          text.length > DECOMPRESS_MAX_CHARS
            ? `${text.slice(0, DECOMPRESS_MAX_CHARS)}\n… (cut; search_context finds the rest)`
            : text;
        const topic = block.topic === undefined ? "" : ` — ${block.topic}`;
        return ok(
          `${block.blockId}${topic}, ${count} message(s). It stays folded; compress this result again when done.\n\n${cut}`,
        );
      },
    } as AgentTool;
  }

  private searchTool(): AgentTool {
    return {
      name: "search_context",
      label: "Search folded conversation",
      description:
        "Search through compressed block summaries and the messages folded into them by keyword. Use BEFORE decompressing to find the right block.",
      parameters: obj(
        {
          query: str({ description: "Search query" }),
          limit: opt(int({ description: "Max results (default 5)" })),
        },
        { open: true },
      ),
      execute: async (_id: string, args: { query: string; limit?: number }) => {
        const core = toCore(this.log());
        const byId = new Map(core.map((c) => [c.id, c]));
        const folded: MessageInput[] = [];
        for (const block of this.state.blocks) {
          if (!block.active) continue;
          for (const id of block.effectiveMessageIds) {
            const m = byId.get(id);
            const ref = this.state.messageRefs.byRaw[id];
            if (m === undefined || ref === undefined || m.role === "system" || !m.text) continue;
            folded.push({ ref, text: m.text, role: m.role, blockId: block.blockId });
          }
        }
        const results = searchBlocks(
          [...blockDocs(this.state), ...messageDocs(folded)],
          args.query,
          {
            limit: args.limit ?? 5,
          },
        );
        if (results.length === 0) return ok(`nothing found for "${args.query}"`);
        return ok(
          results
            .map((r) =>
              r.kind === "block"
                ? `${r.blockId} (block) ${r.title}: ${r.preview}`
                : `${r.ref} in ${r.blockId} (${r.role}): ${r.preview}`,
            )
            .join("\n"),
        );
      },
    } as AgentTool;
  }

  private statusTool(): AgentTool {
    return {
      name: "acp_status",
      label: "Context status",
      description:
        "Show context usage and compressible ranges. No args = overview; pass scope/view/tool/sort/limit for targeted listings.",
      parameters: obj(
        {
          scope: opt(
            str({
              description:
                '"uncompressed": history outside active blocks; "compressed": block ledger; omit = default overview',
            }),
          ),
          view: opt(
            str({ description: '"messages" for a per-message listing; "ranges" is the default' }),
          ),
          tool: opt(
            str({ description: 'With view:"messages": only list results of this tool name' }),
          ),
          sort: opt(
            str({ description: 'With view:"messages": order by "size", "time", "tool", or "age"' }),
          ),
          limit: opt(int({ description: "Max entries to list" })),
        },
        { open: true },
      ),
      execute: async (
        _id: string,
        args: { scope?: string; view?: string; tool?: string; sort?: string; limit?: number },
      ) => {
        const config = this.config();
        const core = toCore(this.log());
        const status = this.core.status(this.state, this.lastTokens, config);
        const usage = Math.round(status.contextUsage * 100);
        const head = `Context: about ${status.tokenCount} of ${status.modelContextLimit} tokens (${usage}%), ${status.activeBlocks} active block(s).`;
        const { scope, view, sort } = args;
        const report = buildStatusReport(this.state, core, defaultCountTokens, {
          ...(scope === "compressed" || scope === "uncompressed" ? { scope } : {}),
          ...(view === "messages" || view === "ranges" ? { view } : {}),
          ...(args.tool === undefined ? {} : { tool: args.tool }),
          ...(sort === "size" || sort === "time" || sort === "tool" || sort === "age"
            ? { sort }
            : {}),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          config,
          originalMessages: core,
        });
        return ok(`${head}\n${report}`);
      },
    } as AgentTool;
  }
}
