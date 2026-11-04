# ADR 0014: ACP is the first real agent integration

- Status: Accepted
- Date: 2026-11-04
- Related: [03-agents.md](../spec/03-agents.md#1-acp-runtime), [07-delivery.md](../spec/07-delivery.md)

## Context

On the development machine, endpoint-security software kills Claude Code and Codex at start.
DeepSeek Harness (DSH) runs there and has an ACP server: on 2026-11-04,
`dsh acp` answered `initialize` with `agentInfo.name = "deepseek-harness-acp"` and session
capabilities `close`, `list`, `resume`. The same ACP client also covers OpenCode, Gemini CLI and
other ACP agents.

## Decision

- After the mock agent, the first real agent is DSH through `dsh acp`.
- Claude Code (`claude-agent-acp`) and Codex (`codex-acp`) profiles are verified later on a
  machine where they can run. (ADR 0015 later made ACP the only runtime protocol.)

## Alternatives

- Claude Code first: the most valuable integration, but it cannot run on the
  development machine.
- Codex launch first: same problem.

## Consequences

- The first real end-to-end demo is a task started from Feishu and run by DSH, not a
  terminal session the user started.
