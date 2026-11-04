// Approval pipeline, M1 subset (docs/spec/04-herder.md §3): guard list → owner rules → owner.
// The Reviewer tier comes in M3. Any failure escalates; no path from an error leads to allow.

import type { Decision, Item, Mode, Rule } from "@agentherd/protocol";
import { type ExtraGuard, guardCheck, matchRules } from "@agentherd/rules";

export interface PipelineContext {
  mode: Mode;
  rules: readonly Rule[];
  home: string;
  extraGuards?: readonly ExtraGuard[];
}

export interface PipelineResult {
  decision: Decision;
  /** Apply `decision` to the agent now. False → send the item to the owner. */
  apply: boolean;
  /** Set when the pipeline found something but did not apply it (observe mode). */
  suggestion?: Decision;
  ruleId?: string;
}

function escalate(item: Item, risk: Decision["risk"], reason: string): Decision {
  return {
    itemId: item.id,
    action: "escalate",
    confidence: 0,
    risk,
    source: "rule",
    reason,
    precedents: [],
  };
}

function decideUnsafe(item: Item, ctx: PipelineContext): PipelineResult {
  if (item.kind !== "permission") {
    return { decision: escalate(item, "medium", "not a permission request"), apply: false };
  }
  if (item.toolCall !== undefined) {
    const guard = guardCheck(item.toolCall, { cwd: item.cwd, home: ctx.home }, ctx.extraGuards);
    if (guard.hit) {
      // Guard-listed actions always go to the owner, in every mode, whatever the rules say.
      return { decision: escalate(item, "high", `guard list: ${guard.reason}`), apply: false };
    }
  }
  const hit = matchRules(ctx.rules, item, ctx.home);
  if (hit === null) {
    return { decision: escalate(item, "medium", "no rule matched"), apply: false };
  }
  const ruled: Decision = {
    itemId: item.id,
    action: hit.action,
    confidence: 1,
    risk: "low",
    source: "rule",
    reason: `rule ${hit.rule.id}`,
    precedents: [],
  };
  if (ctx.mode === "observe") {
    return {
      decision: escalate(item, "low", `observe mode; rule ${hit.rule.id} would ${hit.action}`),
      apply: false,
      suggestion: ruled,
      ruleId: hit.rule.id,
    };
  }
  return { decision: ruled, apply: true, ruleId: hit.rule.id };
}

export function decide(item: Item, ctx: PipelineContext): PipelineResult {
  try {
    const result = decideUnsafe(item, ctx);
    // Defense in depth: only a rule may produce an applied decision here.
    if (result.apply && result.decision.source !== "rule") {
      return {
        decision: escalate(item, "high", "pipeline produced an unexpected decision"),
        apply: false,
      };
    }
    return result;
  } catch (error) {
    return {
      decision: escalate(item, "high", `pipeline error: ${(error as Error).message}`),
      apply: false,
    };
  }
}
