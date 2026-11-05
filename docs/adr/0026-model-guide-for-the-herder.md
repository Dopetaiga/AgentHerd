# ADR 0026: A model guide tells the Herder which models are strong; the owner can edit it

- Status: Accepted
- Date: 2026-11-05
- Related: [ADR 0025](0025-herder-picks-model-per-task.md)

## Context

After ADR 0025 the Herder picks a task's model but knows nothing about the models beyond their
names. The maintainer: "router的话我理解是需要一个skill什么的提醒，就比如说现在的模型排名，opus最强，其次是谁".
Asked where the ranking comes from, the maintainer chose a built-in default the owner can edit
on the 主管 page, and no price or context-window data.

## Decision

- `packages/herder/src/model-guide.ts` ships `DEFAULT_MODEL_GUIDE`: three tiers (strongest,
  balanced, cheap and fast) with the current model families and when to use each, dated.
- `config.json` `modelGuide` holds the owner's text; unset means the default
  (`effectiveModelGuide`). Local API: `modelGuide()` → `{text, custom, defaultText}`,
  `setModelGuide(text | null)`; saving the default text or "" clears it.
- The Herder reads the guide in `session_list` under the model list (only when there are
  models), fresh on every call, so an edit applies to the next task without a restart. The
  system prompt says to follow it; a model the owner names still wins.
- The 主管 page shows the guide in a text box with 保存 and 恢复默认.

## Alternatives considered

- **Pull a public leaderboard (OpenRouter, LMArena).** Rejected for now: formats change, access
  from China is unreliable.
- **Owner-only text, no default.** Rejected: an empty guide gives the Herder nothing.
- **Price and context window from pi-ai.** Not wanted by the maintainer.

## Consequences

- The default goes stale; it is updated with AgentHerd releases, and the owner can override it.
- The guide is advice in the Herder's context, not a rule; the tool still checks that the agent
  can run the model.
