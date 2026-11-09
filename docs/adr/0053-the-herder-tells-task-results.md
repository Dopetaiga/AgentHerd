# ADR 0053: The Herder tells task results in its own words, in a style the owner picks

- Status: Accepted
- Date: 2026-11-09
- Amends: [ADR 0019](0019-relay-verbatim-board-and-reports.md) (who writes the report body),
  [ADR 0049](0049-short-messages-written-by-the-agent.md) (the agent's short text and the summary
  turn), [ADR 0036](0036-message-cards-by-kind.md) (the reply hint)

## Context

Reports read like forms. With ADR 0049 every agent turn started with "your replies are read on a
phone, under 300 characters, conclusion first", and the report body was the agent's own
`herd_report` summary or a summary turn. Agents obeyed: 「结论：3 处残留仍存在，坏锚点实际有 2
个引用点；另有 8 个无人认领且可做的 issue。清单已存 …」. Correct, and stiff. The owner talks to the
Herder in a chat, then gets results in a different voice that knows nothing of that chat.

Personal agents that hand work to workers almost all let the main agent tell the result
(researched 2026-11-09):

| Product | How a worker's result reaches the user |
| --- | --- |
| OpenClaw | The child's result goes to the requester's main agent as a follow-up turn; it answers the user "in normal assistant voice", may stay silent (`NO_REPLY`) |
| nanobot (HKUDS, 50k★) | `subagent_announce`: "Summarize the outcome naturally for the user. Keep it brief (1-2 sentences). Do not mention technical details like subagent or task IDs" |
| boop-agent | The dispatcher relays the result "in YOUR voice, tightened for iMessage"; URLs verbatim |
| open-instinct | Persona: "texts like a capable friend… Say less. Do more"; workers never speak to the user |
| Nova | The main agent restates results "without changing or adding facts" |
| nanoMuse, moltis | The main agent speaks; a `[quiet]`-style marker means nothing to say |
| OpenMuse | The worker's summary verbatim (the stiff one) |

ADR 0049 rejected a Herder rewrite: it would break ADR 0019 (what the agent said reaches the
owner) and cost one more model call. The first is kept by attaching the agent's reply, unchanged,
one tap below; the second costs one cheap call per report, a few seconds and a fraction of a fen.

## Decision

1. **The Herder tells every task result.** At the end of a turn (`report`) and when a
   `herd_report` needs the owner (`notice`: waiting, blocked, failed) core asks
   `HerderPort.voice(request)`. The request carries the task's title, how it ended, the agent's
   last reply and its own `herd_report`, all untrusted. The Herder runs one turn in its own
   conversation (queued behind the owner's) with `[Task result, not from the owner]` and the reply
   quoted: tell the owner what came out of it and what they must do, in its words and style;
   never add or change facts, numbers, paths or links; leave out how the agent worked. The answer
   is the report body; the agent's reply is the card's full reply. `[quiet]` means the owner
   already knows: nothing is sent (audited `report.silent`).
2. **No direct path for urgent results.** The owner asked for the Herder to speak for all of them
   (2026-11-09). Approval cards and watchdog, GitHub, mail and new-work notices are not task
   results and stay as they are.
3. **When the Herder cannot speak** (no Herder, every model failed, or no answer within
   `VOICE_TIMEOUT_MS` = 3 minutes) the report still goes: body 「主管暂时说不了话，任务的原话在下面
   「完整回复」里。」 with the reply attached; a notice falls back to ADR 0049's text. A failed voice
   turn neither alerts nor is held for retry (ADR 0037): the report is what matters.
4. **A voice turn changes nothing.** It is an `event` turn: no tasks, prompts, memory writes,
   style changes; `notify` and `ask` are refused (everything goes in the reply). It may look
   things up. The reply follows the 100-word limit (ADR 0049) like any other.
5. **Agents write for the Herder.** With a voicing Herder the reply hint becomes: the Herder reads
   your reply and tells the owner; end each turn with what you did or found, where the results
   are, and what is left or needs the owner; no long code or logs. No more "under 300 characters,
   conclusion first", and no summary turn. `herd_report` keeps its 100-word summary.
6. **Three styles, picked by the owner.** `HerderStyle` = `friend` (default) | `partner` |
   `secretary`, each copied nearly word for word from a real persona:
   - 能干的朋友 `friend`: open-instinct `PERSONA.md` (warm, direct, say less, one idea per message).
   - 有主见的搭档 `partner`: OpenClaw's `SOUL.md` template (have opinions, not a corporate drone,
     not a sycophant); its own view is marked as its own (「我觉得…」).
   - 干练秘书 `secretary`: vercel-labs/personal-agent-template + nanobot `SOUL.md` (result first,
     no filler, never fake confidence).
   Shared rules: first person, the owner's language, whole sentences, no 「结论：」 forms. The style
   is part of the system prompt (`packages/herder/src/style.ts`). The owner picks it in the first
   run (a step after the Herder's model), in Settings, or in chat (`style_set`, owner turns only).
   It lives in `config.json` (`herderStyle`) and is read each turn: a change applies to the next
   message and costs one prompt-cache miss.

## Alternatives

- **Gentler wording in the agent's prompt only.** Cheaper, but the agent still knows nothing of
  the owner's chat, and each agent writes in its own voice.
- **Herder speaks, urgent results go direct.** Two voices again; the owner declined it.
- **A free-form persona text.** More power, more ways to break the rules; three tested presets
  first, a custom text can come later.

## Consequences

- One Herder turn per report (flash model: about 1–3 s and well under 1 分 with a warm cache). A
  report waits behind the owner's own Herder turns; after 3 minutes it goes without the Herder.
- The Herder's conversation now holds every result, so it can answer 「那个任务怎样了」 from it;
  `task-reported` events are no longer sent for voiced reports.
- The report body is no longer the agent's words; they are one tap away and still the record.
- A voice answer that arrives after the timeout is kept in the Herder's conversation but not sent.
