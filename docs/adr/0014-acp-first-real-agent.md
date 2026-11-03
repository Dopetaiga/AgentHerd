# ADR 0014: ACP is the first real agent integration

- Status: Proposed
- Date: 2026-11-04
- Related: [03-agent-adapters.md](../spec/03-agent-adapters.md#6-acp-agents), [07-delivery.md](../spec/07-delivery.md)

## Context

On the development machine, endpoint-security software kills Claude Code and Codex at start.
DeepSeek Harness (DSH) runs there and has an ACP server: on 2026-11-04,
`dsh acp` answered `initialize` with `agentInfo.name = "deepseek-harness-acp"` and session
capabilities `close`, `list`, `resume`. One ACP adapter also covers OpenCode, Gemini CLI and
other ACP agents.

## Decision

- After the mock agent, the first real agent is the ACP adapter in launch mode, tested with
  `dsh acp`.
- The Claude Code attach adapter moves to a later milestone and is verified on a machine
  where Claude Code can run.

## Alternatives

- Claude Code attach first: the most valuable integration, but it cannot run on the
  development machine.
- Codex launch first: same problem.

## Consequences

- The first real end-to-end demo is a task started from Feishu and run by DSH, not a
  terminal session the user started.
