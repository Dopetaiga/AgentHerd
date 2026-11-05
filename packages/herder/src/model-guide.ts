// Model tiers: which of the owner's models are strong, balanced or fast (ADR 0028, replacing the
// free-text guide of ADR 0026). The owner arranges them by dragging on the 主管 page; models the
// owner has not placed are placed by name rules, and a model the rules do not know is "balanced".
// The Herder reads the tiers as text and picks a tier from what the task is.
// Tiers hold model names, not services: a model several services offer is one entry, and the
// Herder's pick goes to the first of those services that answers (see tools.ts session_start).

export type Tier = "strong" | "balanced" | "fast";

export const TIERS: readonly Tier[] = ["strong", "balanced", "fast"];

/** Model names per tier, strongest first within a tier. */
export type ModelTiers = Record<Tier, string[]>;

export interface TierEntry {
  /** The model id, e.g. `claude-opus-5-5`. */
  model: string;
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

/**
 * Places every model in `models` (names, each once): where the owner put it in `saved`, else by
 * the name rules after the owner's ones. Names in `saved` no longer in the list are dropped.
 */
export function placeModels(models: readonly string[], saved?: Partial<ModelTiers>): TierPlacement {
  const known = new Set(models);
  const out: TierPlacement = { strong: [], balanced: [], fast: [] };
  const placed = new Set<string>();
  for (const tier of TIERS) {
    for (const model of saved?.[tier] ?? []) {
      if (!known.has(model) || placed.has(model)) continue;
      placed.add(model);
      out[tier].push({ model, auto: false });
    }
  }
  for (const model of models) {
    if (placed.has(model)) continue;
    out[tierOf(model)].push({ model, auto: true });
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
    const names = placement[tier].map((e) => e.model);
    if (names.length > 0) lines.push(`${TIER_TEXT[tier]}: ${names.join(", ")}`);
  }
  if (lines.length === 0) return "";
  return [
    "Model tiers (the owner's ranking; earlier in a tier is preferred):",
    ...lines,
    "Pick the tier from what the task is. If the owner names a model, use it.",
  ].join("\n");
}
