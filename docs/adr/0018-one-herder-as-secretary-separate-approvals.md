# ADR 0018: One Herder for all projects, a light model that acts as a secretary; approvals in a separate pipeline

- Status: Accepted
- Date: 2026-11-04
- Related: [04-herder.md](../spec/04-herder.md), supersedes [ADR 0017](0017-resident-herder-per-project.md), amends [ADR 0003](0003-herder-on-pi-agent-core.md) and [ADR 0007](0007-tiered-decisions-fail-open-to-human.md)

## Context

ADR 0017 made one resident Herder per project on the strongest model, and gave it two jobs:
manage agents and judge approvals. Discussion with the maintainer on 2026-11-04 showed that
the two jobs need different things:

- Managing agents is light work: understand the owner's message, pick the project and the
  agent, start or steer sessions, keep the board, notice stuck sessions. dsh-superagent runs
  its Router for this work on a light model ("用轻量模型即可"). The Router passes the
  owner's words on and does not rewrite them into a plan, so a small model cannot distort
  the task.
- Judging an approval is heavy work, and a wrong `allow` cannot be undone. dsh-superagent
  can use a light Router because its Workers run commands without approval. AgentHerd exists
  to approve, so approvals need the strongest model.
- Work across projects ("how are all tasks going", "apply the fix from A to B") needs one
  view. One Herder per project gives the owner several bots or an extra routing layer.

The maintainer described the Herder as "like a secretary".

## Decision

- **One Herder for all projects.** It is a resident Pi agent session on a light model chosen
  by the user. It is the owner's secretary: it reads the owner's direct messages, starts and
  steers sessions, relays the owner to a task, keeps the task board, writes completion
  reports when an agent did not, and acts on watchdog alarms.
- **The Herder never approves.** It has no `decide` tool for permission requests. It can only
  pass an item on.
- **Approvals go through a separate approval pipeline:** guard list → owner rules →
  **Reviewer** → owner. The Reviewer is one call to the strongest model the user configured,
  per item, with a project snapshot. It is not resident and keeps no session. Items from
  different projects are reviewed in parallel.
- **State lives in `herd.db`.** The Herder's session is compacted when it grows; after a
  compaction it reads task state from the store and does not trust its memory.
- **The optional small-model pre-filter is removed.** Its job (cheap decisions on low-risk
  items) is done by rules; the Herder is already the light model and may not approve.
- The interface keeps a project id on every event, so the Herder can be split per project
  later if one session becomes a bottleneck. dsh-superagent lists the same question as open.

## Alternatives

- One resident Herder per project on the strongest model (ADR 0017): strong judgment, but
  expensive while idle, no cross-project view, and several bots for the owner.
- One light Herder that also approves: cheapest, but the weakest model would decide what runs
  on the owner's machine.
- No resident Herder, only the approval pipeline and fixed commands: no model cost, but the
  owner must use exact command syntax and nothing notices a stuck session.

## Consequences

- Two model settings in onboarding: a fast model for the Herder, a strong model for the
  Reviewer. Either can be skipped; without the Reviewer, unmatched items go to the owner.
- `Decision.source` is `rule`, `reviewer` or `human`.
- One Herder session must handle bursts. Events are queued and batched into its next turn.
- The glossary changes: "Herder" now means the secretary, not the whole decision pipeline.
