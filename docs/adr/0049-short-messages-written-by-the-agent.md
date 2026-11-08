# ADR 0049: Short messages, written by the agent

- Status: Accepted
- Date: 2026-11-08
- Amends: [ADR 0019](0019-relay-verbatim-board-and-reports.md) (report body),
  [ADR 0036](0036-message-cards-by-kind.md) (`reportMaxChars`),
  [ADR 0046](0046-tell-the-owner-at-the-right-time.md) (`herd_ack`),
  [ADR 0047](0047-follow-the-pull-requests-tasks-open.md) (pull request notices),
  [ADR 0048](0048-watch-mail-only-when-asked.md) (mail notices)

## Context

Every message on the owner's phone costs attention. dsh-superagent holds every IM message to 100
words, counted with Chinese split into words, links included; the worker writes its own report
and the orchestrator only relays facts. AgentHerd had no such limit: a report could be 400–600
characters of steps, a pull request comment produced a notice and then a report saying the same,
an acknowledgement was a new message far from the request it answered, and five mails with 100
characters of preview each made one long message.

Who writes the short text matters. A Herder rewrite breaks ADR 0019 (what the agent said reaches
the owner unchanged) and costs a model call per message. The agent knows what it did.

## Decision

1. **Limit.** A message to the owner is at most 100 words (`OWNER_WORDS_MAX`), counted with
   `Intl.Segmenter("zh", { granularity: "word" })` (word-like segments; links count). Text
   without word breaks is held to 8 characters per allowed word. `packages/core/src/owner-text.ts`.
2. **The agent writes it.** `herd_report`'s `summary` is one or two sentences for the owner: the
   result and what the owner must do, no steps. Over 100 words the tool call is refused with a
   message asking for a shorter one; nothing is cut silently.
3. **Report body.** In this order: the turn's own `herd_report` summary (`ready`, `failed`,
   `blocked`, `waiting`); the reply when it fits; one summary turn (100 words, no tools); else the
   reply cut after 100 words with "…". The full reply stays one tap away ("Full reply") whenever
   the body is not the reply. Automatic decisions are folded under their count.
4. **Acknowledgement.** `herd_ack` is at most 30 words and is sent as a reply to the owner's
   message that started the turn (Feishu `im.v1.message.reply`; a plain message when there is
   none or the reply fails). AgentHerd's own turns (background checks) are not acknowledged.
5. **Pull requests.** A person's comment and failed checks wake the task without a notice of
   their own: the task acknowledges and reports. Approval, merge and close stay one line.
6. **Mail.** Sender and subject with the link; previews of at most 40 characters; at most 3 mails,
   then 「还有 N 封」; the whole message within 100 words (fewer mails, then no previews, then cut).
7. **Herder.** Its prompt holds every owner message to 100 words. A longer final reply is asked
   to be written again once (audited `herder.reply.long`), then cut. `ask` and `notify` refuse
   longer text.
8. Relay (the owner talking to the agent directly) and the board are not limited.

## Consequences

- Reports are a sentence or two; the details are in the folded full reply.
- An agent that writes a long `herd_report` summary gets a tool error and has to try again.
- The report no longer depends on `reportMaxChars`; it is `reportMaxWords` (default 100).
- The owner hears about a pull request comment once, from the task.

## Alternatives

- **Herder rewrites every message.** Rejected: breaks ADR 0019, adds a model call and latency
  per message, and the Herder knows less than the agent.
- **Cut silently.** Rejected for the agent's own summary: the agent can do better when told.
- **Characters instead of words.** Rejected: 100 Chinese characters say much less than 100 words.
