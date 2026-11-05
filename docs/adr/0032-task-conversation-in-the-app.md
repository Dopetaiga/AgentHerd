# ADR 0032: Show each task's conversation in the app

- Status: Accepted
- Date: 2026-11-05

## Context

The owner (2026-11-05): "任务这里进行中，但我希望可以点开看对话". The 任务 page showed one line per
task (project · agent · last report). The agent's replies were only kept for the current turn,
in memory, and tool calls only went to the watchdog.

## Decision

- `herd.db` gets a `transcript` table (schema version 3). Per task it keeps, in order:
  - `prompt`: what AgentHerd sent the agent (the owner's or the Herder's words, the summary
    request), without the reply hint;
  - `agent`: reply text, one line per stretch between tool calls;
  - `tool`: the command or title of a tool call, with its status updated in place;
  - `note`: a failed turn or a model switch.
  Lines are redacted like the audit log, cut at 20 000 characters; a task shows its last 2 000.
- Reply text not yet followed by a tool call or the turn's end is `live`; `Herd.transcript(id)`
  returns `{ entries, live }`, the host exposes it as `transcript(taskId)`.
- Clicking a task row opens a dialog with the conversation. It polls every 1.5 s, follows new
  lines while the owner is at the bottom, and shows a cursor after live text.
- Approval requests stay where they are (the row and Feishu); the dialog is read-only.

## Consequences

- Tasks started before this change have no conversation.
- `herd.db` grows with what agents say; nothing is pruned yet.
