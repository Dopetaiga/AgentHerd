# ADR 0019: Owner talks to tasks by relay, words pass verbatim, progress is a pinned board plus completion reports

- Status: Accepted
- Date: 2026-11-04
- Related: [04-herder.md](../spec/04-herder.md), [05-channels.md](../spec/05-channels.md), [ADR 0012](0012-channel-is-the-only-decision-surface.md), [ADR 0018](0018-one-herder-as-secretary-separate-approvals.md)

## Context

With one Herder for all projects ([ADR 0018](0018-one-herder-as-secretary-separate-approvals.md)),
the owner needs a way to talk to one task directly, a way to see progress, and a rule for what
the Herder may change when it passes messages on. Inputs:

- dsh-superagent sends messages on a task's thread straight to its Worker; the Router only
  gets a notice and does not judge the content. A Worker hands back a message that is not
  for it. Workers report with `orchestrator_report` (`progress`, `waiting`, `ready`,
  `blocked`, `failed`, `dropped`); the stage is computed from the last report.
- Muse (Meta) works in the background and shows what it is doing in a status line and a
  goals page; it does not send a stream of progress messages.
- It is not known whether a Feishu bot can open topics in a direct chat.
- A prototype on 2026-11-04 sent a card with a table component to the owner, pinned it with
  the bot's existing scopes, and updated it in place twice with `im.v1.message.patch`. The
  owner found it good.
- The maintainer asked for: a way to be put through to one task; a reply when an agent
  finishes that says what it did; no filtering of what agents say to the owner.

## Decision

- **Relay.** The owner asks the Herder ("put me through to the login fix", or picks a task
  on the board). From then on, every direct message goes to that task's session without the
  Herder, until the owner ends the relay, the task ends, or `relayIdleMinutes` (default 30)
  pass with no message. A status card shows the active relay and has an "End relay" button.
  `/herder <text>` reaches the Herder during a relay. A message sent while the agent is
  working is queued for its next turn; `/interrupt <text>` cancels the current turn first.
- **Verbatim.** The Herder may add, never rewrite. The owner's words go to the agent
  unchanged; the agent's words go to the owner unchanged. When the Herder adds context to a
  new task (project path, which earlier task "that one" means), it is a separate block
  labeled as added by the Herder. If the Herder cannot tell which task the owner means, it
  asks with buttons; it does not guess.
- **Progress.**
  - The core watches sessions all the time (ACP events, and a watchdog timer). This costs no
    tokens.
  - A **task board** card lists all tasks, the ones that need the owner first. It is pinned
    in the chat and updated in place by code when a stage changes, not by the model.
  - When a task ends (done, blocked, failed), the owner always gets a **completion report**:
    what was done, what was verified, outputs, risks, automatic decisions taken.
  - **The agent summarizes itself, based on size.** If the agent's final reply is at most
    `reportMaxChars` (default 600), it is the report, verbatim. If it is longer, AgentHerd
    sends the same session one more prompt: summarize what you did for the owner in at most
    `reportMaxChars`, no tool calls. The answer is the report; the full reply stays one tap
    away. The summary is the agent's own words, so the verbatim rule holds. It is asked once;
    if it fails or is still too long, the report is the folded original.
  - During work, the owner is contacted only for approvals and for questions from the agent.
  - A daily digest is on by default and can be turned off.
- **Length.** At session start AgentHerd adds a labeled note to the first prompt: replies go
  to a phone, keep each under `replyHintChars` (default 300), conclusion first, details in
  files or commit messages, no long code or logs. In the channel, a message over
  `foldChars` (default 600) shows its first lines and folds the rest; code blocks and logs
  are folded; a message over the card limit is stored as a file and sent as a link. Nothing
  is shortened by the Herder.
- **No importance filter.** The Herder does not decide whether a message is worth the
  owner's time. Everything the agent says to the owner, every stage change, approval and
  alarm is delivered. Tool-call activity is recorded, not sent; the owner can ask for it.
- **`herd_report`.** AgentHerd offers an MCP tool `herd_report(state, summary, ...)` to each
  session it starts (through `mcpServers` in `session/new`, where the agent supports it).
  States as in dsh-superagent. It sets the stage (`blocked`, `failed`, ...); it is optional,
  because the report text comes from the final reply or the summary prompt.

## Alternatives

- One chat topic per task: depends on topics in a direct chat (unknown). Kept as an option on
  top of relay if topics work.
- Scheduled progress messages every N hours: noisy, often "still working". Replaced by the
  pinned board.
- A model that judges which messages are worth sending (Muse style): saves attention, but the
  maintainer prefers to see everything, and a wrong judgment hides a message.
- The Herder rewrites the owner's request into a task brief: a light model can distort it.

## Consequences

- The channel interface needs pin and in-place update of any message, not only item cards.
- A store field per channel chat holds the active relay.
- Agents without MCP support in `session/new` still get reports; their stage is taken from
  the stop reason and the reply.
- A long final reply costs one extra short agent turn.
- Rejected: the Herder shortens long replies. That breaks the verbatim rule.
