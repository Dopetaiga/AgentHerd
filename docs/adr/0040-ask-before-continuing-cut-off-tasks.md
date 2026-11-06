# ADR 0040: After a restart, the Herder asks whether to continue cut-off tasks

- Status: Accepted
- Date: 2026-11-07

## Context

ADR 0039 keeps tasks across restarts and lets the owner continue an ended one, but a task that was
in the middle of work when AgentHerd stopped or crashed just stayed ended. Restarting it on its
own could repeat work or touch files the owner no longer wants touched; leaving it silently ended
means the owner may not notice. The owner (2026-11-07): "我觉得让主管问一下用户比较好".

## Decision

- On stop, the Herd records the ids of tasks that were unfinished (a turn running or queued, or a
  stage other than done/failed) in state key `tasks.interrupted`. On start, crash rows that were
  unfinished are added.
- Once the channel is up, if there is a Herder, AgentHerd sends one question card (the Herder's
  purple 「主管问你」) listing up to 5 such tasks with project and agent. Buttons: one task →
  「接着做」「不用了」「其他」; several → 「全部接着做」「不用了」, 「只接着做：<name>」 for the first two,
  「其他」.
- The answer goes to the Herder like any answer. Its prompt says: on yes, session_prompt each
  chosen task that AgentHerd restarted and it should carry on; on no, leave them ended.
- Asked once: the state is cleared at start. Without a Herder nothing is asked.

## Consequences

- Nothing restarts without the owner saying so.
- Restarting AgentHerd while a task runs leads to one question on the next start.
