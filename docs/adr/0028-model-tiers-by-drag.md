# ADR 0028: Model tiers the owner arranges by dragging, filled in by name

- Status: Accepted
- Date: 2026-11-05
- Supersedes: [ADR 0026](0026-model-guide-for-the-herder.md)

## Context

ADR 0026 gave the Herder a free-text model guide. The maintainer (2026-11-05): "这个我感觉不要文档，要那种可以滑动的，然后用户增加了什么模型，你匹配到适用的参考".
Asked, they chose tiers with drag-and-drop ordering, unknown models defaulting to the middle tier
("认不出的放个均衡默认"), and no separate rules text ("挑法主要还是看任务是啥啊").

## Decision

- Three tiers: 最强 (strong), 均衡 (balanced), 便宜快 (fast). Each holds the owner's models by
  name, strongest first. The 主管 page shows them as three columns; the owner drags a
  model to another tier or another place in a tier.
- `config.json` `modelTiers` keeps where the owner put models. Models not there are placed by name
  rules in `packages/herder/src/model-guide.ts` (`tierOf`: flash/mini/haiku/… → fast;
  opus/gpt-6/Gemini Pro/… → strong; anything else → balanced) after the owner's ones. Models
  removed from the list drop out. 「恢复自动分档」 forgets the owner's placement.
- The Herder reads the tiers in `session_list`, each tier with the kind of task it suits, and picks
  the tier from the task; a model the owner names wins.
- A model name offered by several services is one card listing those services (amended
  2026-11-05, user asked about same-name models).
- `session_start` never starts on a model that does not answer (amended 2026-11-05: a task failed
  on 403 INSUFFICIENT_BALANCE and the Herder asked the owner what to do; the owner said it should
  just switch). It tries, each checked with a test call (a pass is trusted for 10 minutes, a
  failure for 2): what was asked (`service/model`, or every service offering the name), other
  services offering that name, the other models of its tier in order, then the other tiers —
  only models the chosen agent can run. The first that answers is used; the tool result names the
  switch and the Herder tells the owner in one line. Placements saved as `service/model` before
  this change are read as the model name.
- The free-text guide and its API (`modelGuide`, `setModelGuide`) are removed; an old
  `modelGuide` value in `config.json` is ignored.

## Consequences

- Starting a task on a model that has not been checked recently costs one short test call per
  service tried.

- The name rules go stale as models change; the owner fixes a wrong placement by dragging, and the
  rules are updated with AgentHerd.
