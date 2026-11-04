# ADR 0017: A resident Herder per project, on the strongest model, that manages agents

- Status: Accepted
- Date: 2026-11-04
- Related: [04-herder.md](../spec/04-herder.md), amends [ADR 0003](0003-herder-on-pi-agent-core.md) and [ADR 0007](0007-tiered-decisions-fail-open-to-human.md)

## Context

The first draft made the Herder a stateless pipeline: small-model classification (L1), then a
read-only Pi agent (L2). The maintainer said the supervisor must be the strongest model and
need not be read-only. In dsh-superagent ("Super-agent design exploration", 2026-10-31) the
Router is not read-only either: it has 14 management tools plus `bash` and `read`; it does not
do the work itself, and it runs a light model because it only routes. AgentHerd's Herder also
judges risk for approvals, where a wrong answer is costly, so it needs a strong model.

## Decision

- One resident Herder per project directory: a Pi agent session with the project's context,
  compacted when it grows, saved and reloaded across restarts.
- It runs the strongest model the user configured.
- It manages agents: decide items, continue, steer, cancel, start sessions, assign tasks. It can
  read inside the project. It cannot write files or run arbitrary shell commands.
- Its own tool calls pass the guard list first; a match escalates to the owner. All its tool
  calls are audited.
- Pipeline: guard list → owner rules → optional cheap pre-filter (off by default) → Herder →
  owner. The Herder also does the Watchdog job (loops, agent errors).

## Alternatives

- Stateless tiers with a read-only L2 (first draft): cheap, but no project context and no way
  to manage agents.
- A light Router model as in dsh-superagent: fine for routing, too weak for approval judgment.
- A Herder that also edits code and runs commands: more capable, but it would compete with its
  own agents for the same files and needs its own supervision. Kept out of v1.

## Consequences

- Higher model cost per escalated event; rules and the guard list keep most events free.
- Context compaction and restore are part of the core, not an afterthought.
