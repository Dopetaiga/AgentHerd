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
