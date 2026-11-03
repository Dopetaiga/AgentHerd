# ADR 0007: Tiered decisions that fail toward the human

- Status: Proposed
- Date: 2026-11-04
- Related: [04-herder.md](../spec/04-herder.md), [06-security.md](../spec/06-security.md)

## Context

Most prompts are routine and cheap to decide; a few are risky. A model call per prompt is
slow and costs money; a rule cannot judge new situations. A supervisor that hangs or guesses
"allow" on error is worse than no supervisor.

## Decision

- Pipeline: guard list → L0 rules → L1 small-model classification → L2 read-only Pi agent →
  the owner. Each step can stop the pipeline.
- The guard list runs first and can only escalate.
- Any error, timeout or unreadable model output gives `escalate`, or `defer` at the hook,
  never `allow`.
- If AgentHerd is not running, hooks return at once and the agent asks the user itself.

## Alternatives

- Model decides everything: slow, costly, hard to audit.
- Rules only: the user writes rules all day; no help for new cases.

## Consequences

- AgentHerd can be turned off or crash without blocking agents.
- Every decision carries its source, so mistakes can be traced to a rule, a precedent or a
  model call.
