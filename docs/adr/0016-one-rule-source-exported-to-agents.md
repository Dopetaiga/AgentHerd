# ADR 0016: One rule source, exported to each agent's own config

- Status: Proposed
- Date: 2026-11-04
- Related: [03-agents.md](../spec/03-agents.md#2-rule-export), [04-herder.md](../spec/04-herder.md#l0-rules)

## Context

With ACP only (ADR 0015), sessions the user starts in a terminal are not supervised. Each
agent CLI already has its own permission config (for example Claude Code
`permissions.allow` / `deny`, Codex approval policy and command rules, OpenCode
`permission`). The maintainer proposed on 2026-11-04 to keep one AgentHerd rule format and
translate it into those configs.

## Decision

- The AgentHerd rule set is the only source of rules.
- One exporter per agent writes `allow` / `deny` rules and the guard list into that agent's
  config, in an AgentHerd-owned block, with a backup.
- A translation may only keep or narrow a rule, never widen it. Each rule shows per agent
  whether it is `exact`, `narrowed` or `not exported`.
- Export is one-way and opt-in per agent. Manual edits to the AgentHerd block are detected
  and shown, not imported.

## Alternatives

- No export: terminal sessions get nothing from AgentHerd.
- Two-way sync: merging hand edits from several formats is error-prone and could widen rules.
- Hooks: richer (channel escalation), but agent-specific runtime code (see ADR 0015).

## Consequences

- Terminal sessions follow the same allow/deny rules and the guard list, even when AgentHerd
  is not running. They do not get model decisions or channel escalation.
- Each exporter must track its agent's config format; formats are open questions until verified.
