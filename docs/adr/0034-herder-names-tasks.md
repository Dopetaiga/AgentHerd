# ADR 0034: The Herder names tasks

- Status: Accepted
- Date: 2026-11-05

## Context

A task's title was the first line of the owner's words, e.g. "帮我看一下pi-desktop目前的issue有哪些
可做的". After a few follow-ups the task was doing something else (checking who already worked
on #2000), and the report header still showed the old question. The owner (2026-11-05): "我看不出来
这个worker到底是谁，我觉得router要负责命名".

## Decision

- `session_start` takes a required `name`: a short name for what the agent does, in the owner's
  language, e.g. "pi-desktop：梳理可做的 issue". It is the task's title on the board, in the app and
  in every report. The prompt to the agent is unchanged (the owner's words, verbatim).
- `session_prompt` takes an optional `name`. When new work changes what the task does, the
  Herder renames it (`HerderHost.renameTask`).
- The system prompt tells the Herder to refer to tasks by name.

## Consequences

- Names live in memory like the rest of the task view; tasks started with `/run` still use the
  first line of the owner's words.
