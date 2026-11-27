// Words for the services found on this computer (ADR 0107); no React, so tests can load it.

import type { FoundServiceView } from "@agentherd/host/api";
import { FOUND_SOURCE_NAMES } from "@agentherd/host/api";

/** 「Claude Code、CC Switch」. */
export function sourcesText(sources: readonly string[]): string {
  return sources.map((s) => FOUND_SOURCE_NAMES[s] ?? s).join("、");
}

/** Where it lives and what it serves: 「DeepSeek 官方 · deepseek-flash 等 2 个」. */
export function foundLine(s: FoundServiceView): string {
  const where = s.kind === "builtin" ? `${s.provider ?? ""} 官方` : (s.baseUrl ?? "");
  const format = s.api === "anthropic-messages" ? " · Anthropic 格式" : "";
  const models =
    s.models.length === 0
      ? "加上后自动读模型"
      : s.models.length === 1
        ? s.models[0]
        : `${s.models[0]} 等 ${s.models.length} 个`;
  return `${where}${format} · ${models}`;
}

/** Not yet added first, then by name. */
export function foundOrder(list: readonly FoundServiceView[]): FoundServiceView[] {
  return [...list].sort(
    (a, b) =>
      Number(a.added !== undefined) - Number(b.added !== undefined) || a.name.localeCompare(b.name),
  );
}

/** Only the ones not in AgentHerd yet, by name: what the bar offers. */
export function offered(list: readonly FoundServiceView[]): FoundServiceView[] {
  return foundOrder(list).filter((s) => s.added === undefined);
}

/** The short second half of a chip: 「claude-opus-5-5 · DSH」. */
export function chipNote(s: FoundServiceView): string {
  const short: Record<string, string> = {
    dsh: "DSH",
    "claude-code": "Claude Code",
    "cc-switch": "CC Switch",
  };
  const from = s.sources.map((x) => short[x] ?? FOUND_SOURCE_NAMES[x] ?? x).join("/");
  const model = s.models[0];
  return model === undefined ? from : `${model} · ${from}`;
}

/** What 探测 found, said for a few seconds after it: 「看完了，多了 2 个可以加的」. */
export function lookResult(
  before: ReadonlySet<string>,
  after: readonly FoundServiceView[],
): string {
  const now = offered(after);
  const fresh = now.filter((s) => !before.has(s.id)).length;
  if (now.length === 0) return "看完了，没有可以加的";
  return fresh > 0
    ? `看完了，多了 ${fresh} 个可以加的`
    : `看完了，没有新的（还是这 ${now.length} 个）`;
}
