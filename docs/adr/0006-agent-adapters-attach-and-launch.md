# ADR 0006: Agent adapters with attach and launch modes

- Status: Proposed
- Date: 2026-11-04
- Related: [03-agent-adapters.md](../spec/03-agent-adapters.md)

## Context

The maintainer wants AgentHerd to supervise all common coding agents, not only one. Agents
expose very different integration points: Claude Code has hooks, Codex has an app-server
protocol and session files, many others speak ACP. Users also want to keep starting agents
in their own terminals.

## Decision

- One adapter per agent kind (one shared adapter for all ACP agents), behind one interface.
- Two modes: **attach** (join sessions the user started, through hooks and session files)
  and **launch** (AgentHerd starts the agent through a programmatic protocol).
- Each adapter declares a capability set per mode. The core and UI never assume an
  undeclared capability.
- A scripted mock adapter is part of the product repo and is the base of E2E tests.

## Alternatives

- Launch mode only (like OpenBot or dsh-superagent): full control, but users must change
  how they work.
- Terminal scraping (tmux, pty): works for any agent, but fragile and unsafe for approvals.

## Consequences

- Feature parity differs per agent; the UI shows what each session supports.
- Facts about agent hooks and protocols must be verified per version (open questions Q01–Q07).
