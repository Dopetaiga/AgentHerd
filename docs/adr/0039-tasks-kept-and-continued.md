# ADR 0039: Tasks are kept across restarts and can be continued

- Status: Accepted
- Date: 2026-11-06

## Context

Tasks lived only in memory. After AgentHerd restarted, the board, the app and the Herder had no
tasks, and the Herder told the owner "列表里没有任务". The sessions table had rows, but no title,
stage or report. Pi ran with `--no-session`, so its own conversation was gone too. The owner
(2026-11-06): "这个不太行啊，得持久化管理吧". Chosen scope: keep the record and let an old task be
continued; tasks that were running are not restarted on their own.

## Decision

- herd.db schema 6 has a `tasks` table: title, project, folder, agent profile, model, stage, last
  report, times, why it ended, and the agent's own session id. The Herd saves every task on each
  board change and when it ends.
- On start the Herd loads the 50 newest tasks as ended tasks. A task saved without an end time
  (AgentHerd went away while it ran) is ended then, marked failed unless it was done, and gets
  its memory case.
- A prompt to an ended task starts it again: the same folder and model, its own agent first, then
  Pi, then the others but DSH. If the agent offers ACP `session/load` and has the session, it
  opens it and keeps its own context. Otherwise it gets a new session and the next prompt starts
  with the earlier prompts and replies from the transcript (last 8000 characters), marked as
  history.
- Pi keeps sessions: the bridge runs Pi with `--session-dir <home>/pi-sessions --session-id
  <ACP session id>` when `AGENTHERD_PI_SESSION_DIR` is set (the host sets it), and answers
  `session/load`. Without the variable it runs `--no-session` as before.
- The Herder's `session_list` shows open tasks and the 15 newest ended ones. `session_prompt`
  finds ended tasks too and continues them; `session_cancel`, `session_end` and `relay_start` stay
  for open tasks. The prompt says to continue an earlier task rather than start a new one for the
  same work.
- A continued task does not switch models on its first turn: it already did work.

## Consequences

- The board, the app's task list and the transcripts survive restarts.
- Continuing a task restarts an agent process, which takes a few seconds before the reply.
- DSH and Codex get the history as text; what they did with tools is only in their replies.
- Pi session files accumulate under `<home>/pi-sessions`; nothing deletes them yet.
