# ADR 0033: The Herder does not repeat task reports

- Status: Accepted
- Date: 2026-11-05

## Context

When a task finished, the owner got the task's report, and then the Herder's own message saying
the same thing again (2026-11-05, pi-desktop #2000: "回复了一遍，然后模型的消息还要再回复一遍").
Each report and watchdog alarm started a Herder turn; the prompt asked it to stay quiet unless
needed, but the model used `notify` almost every time.

## Decision

- A report or alarm starts no Herder turn. The Herder holds the last 10 and puts them, quoted as
  agent data under "[Already sent to the owner]", in front of the owner's next message or answer.
- The system prompt says these already reached the owner and must not be repeated.
- Agent text in that block still cannot start or message tasks: `ownerText` must be copied from
  the owner's own words, which the block is not part of.

## Consequences

- One message per finished task, and no model call for it.
- The Herder no longer speaks on its own after a report, e.g. to suggest a next step. The report
  itself ends with the agent's question when it has one.
