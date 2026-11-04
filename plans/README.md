# Plans

A plan is a step-by-step task that a coding agent can execute without guessing. Plans are
written after the spec they implement is stable. They are never deleted: their state changes
in the table below.

Format: copy [TEMPLATE.md](TEMPLATE.md). File name: `NNN-<outcome-in-kebab-case>.md`, where
the name says what is true when the plan is done (for example
`001-mock-approval-reaches-feishu-card.md`).

States: `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED: <reason>`, `REJECTED: <reason>`,
`SUPERSEDED BY NNN`.

| Plan | Title | Milestone | Size | Depends on | State |
| --- | --- | --- | --- | --- | --- |
| [001](001-workspace-protocol-and-rules.md) | The workspace builds, and protocol types and rules are tested | M1 | M | — | TODO |
| [002](002-acp-client-drives-mock-agent.md) | The ACP client runs a scripted mock agent and answers its permission requests | M1 | M | 001 | TODO |
| [003](003-core-approval-loop-with-fake-channel.md) | A mock agent's permission request reaches the owner and the answer goes back | M1 | L | 001, 002 | TODO |
| [004](004-feishu-channel-and-cli.md) | The owner approves a mock agent's request from a real Feishu card, started from a CLI | M1 | M | 003 | TODO |
