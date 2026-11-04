# ADR 0015: ACP is the only runtime protocol to agents

- Status: Accepted
- Date: 2026-11-04
- Related: [03-agents.md](../spec/03-agents.md#1-acp-runtime), supersedes [ADR 0006](0006-agent-adapters-attach-and-launch.md)

## Context

ADR 0006 planned one adapter per agent, with hooks for terminal sessions (attach) and
agent-specific protocols for launched sessions (Codex app-server, Claude Code SDK). The
maintainer wants AgentHerd to depend mainly on ACP from the top layer to the bottom layer, so
that any agent CLI can be added. On 2026-11-04, npm has ACP servers for the main agents:
`@agentclientprotocol/claude-agent-acp` 0.100.0 (Claude Code), `@zed-industries/codex-acp`
0.16.0 (Codex); DSH has `dsh acp` (tested); the client SDK is `@agentclientprotocol/sdk` 2.4.0.

## Decision

- AgentHerd talks to running agents only through ACP, as an ACP client that starts the agent.
- An agent is a profile (command line, env), not a package. Adding an ACP agent needs no code.
- No hooks and no agent-specific runtime protocols in v1. Sessions started outside AgentHerd
  are covered by rule export ([ADR 0016](0016-one-rule-source-exported-to-agents.md)).
- ACP types stay inside `packages/acp-client`; the rest of the core uses AgentHerd types.

## Alternatives

- One adapter per agent with hooks (ADR 0006): supervises terminal sessions with channel
  escalation, but needs code and version tracking per agent, and hook details are unverified.
- Terminal scraping: works for anything, fragile and unsafe for approvals.

## Consequences

- Much less code: one client, one mock agent, profiles.
- Only sessions AgentHerd starts get the Herder and channel escalation. Users start supervised
  work from the channel or the desktop app.
- AgentHerd depends on the quality of each agent's ACP server; gaps are recorded per profile.
- Later options kept open: a Claude Code hook plugin, and AgentHerd as an ACP proxy for editors.
