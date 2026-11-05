// Model tiers: which of the owner's models are strong, balanced or fast (ADR 0028, replacing the
// free-text guide of ADR 0026). The owner arranges them by dragging on the 主管 page; models the
// owner has not placed are placed by name rules, and a model the rules do not know is "balanced".
// The Herder reads the tiers as text and picks a tier from what the task is.

export type Tier = "strong" | "balanced" | "fast";

export const TIERS: readonly Tier[] = ["strong", "balanced", "fast"];

/** Model refs (`service/model`) per tier, strongest first within a tier. */
export type ModelTiers = Record<Tier, string[]>;

export interface TierEntry {
  ref: string;
  /** True when placed by the name rules, not by the owner. */
  auto: boolean;
}

export type TierPlacement = Record<Tier, TierEntry[]>;

// Checked in order: the first match wins. Patterns see the model id in lower case, without the
// vendor prefix of routers (`anthropic/claude-opus-5` → `claude-opus-5`).
const RULES: readonly [RegExp, Tier][] = [
  [
    /flash|\bmini\b|\bnano\b|\blite\b|haiku|highspeed|turbo|\bsmall\b|instant|\bair\b|[-_](?:7|8|9|14)b\b/,
    "fast",
  ],
  [
    /opus|fable|gpt-6|gpt-5\.[5-9]|o3-pro|gpt-[\d.]+-pro|gemini-[\d.]+-pro|gemini-pro|gemini-4|grok-4\.[6-9]/,
    "strong",
  ],
];

/** The tier the name rules give a model; "balanced" when no rule knows it. */
export function tierOf(model: string): Tier {
  const id = model.toLowerCase().split("/").pop() ?? "";
  for (const [pattern, tier] of RULES) if (pattern.test(id)) return tier;
  return "balanced";
}

function modelOfRef(ref: string): string {
  const slash = ref.indexOf("/");
  return slash < 0 ? ref : ref.slice(slash + 1);
}

/**
 * Places every model in `refs`: where the owner put it in `saved`, else by the name rules after
 * the owner's ones. Refs in `saved` that are no longer in the list are dropped.
 */
export function placeModels(refs: readonly string[], saved?: Partial<ModelTiers>): TierPlacement {
  const known = new Set(refs);
  const out: TierPlacement = { strong: [], balanced: [], fast: [] };
  const placed = new Set<string>();
  for (const tier of TIERS) {
    for (const ref of saved?.[tier] ?? []) {
      if (!known.has(ref) || placed.has(ref)) continue;
      placed.add(ref);
      out[tier].push({ ref, auto: false });
    }
  }
  for (const ref of refs) {
    if (placed.has(ref)) continue;
    out[tierOf(modelOfRef(ref))].push({ ref, auto: true });
  }
  return out;
}

const TIER_TEXT: Record<Tier, string> = {
  strong: "Strong — hard problems, large changes, design, bugs nobody understands yet",
  balanced: "Balanced — ordinary features, bug fixes, tests",
  fast: "Fast and cheap — small edits, lookups, wording, running a command to see the result",
};

/** The tiers as the Herder reads them in session_list. Empty when there are no models. */
export function tiersText(placement: TierPlacement): string {
  const lines: string[] = [];
  for (const tier of TIERS) {
    const refs = placement[tier].map((e) => e.ref);
    if (refs.length > 0) lines.push(`${TIER_TEXT[tier]}: ${refs.join(", ")}`);
  }
  if (lines.length === 0) return "";
  return [
    "Model tiers (the owner's ranking; earlier in a tier is preferred):",
    ...lines,
    "Pick the tier from what the task is. If the owner names a model, use it.",
  ].join("\n");
}
