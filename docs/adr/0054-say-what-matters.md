# ADR 0054: The Herder says what matters, with no word limit; memory keeps lessons only

- Status: Accepted
- Date: 2026-11-10
- Amends: [ADR 0049](0049-short-messages-written-by-the-agent.md) (the 100-word limit no longer
  applies to the Herder), [ADR 0053](0053-the-herder-tells-task-results.md) (the voice rules and
  two style texts), [ADR 0038](0038-herder-memory.md) (no `case` per task)

## Context

After ADR 0053 the owner asked about a task that had found nine GitHub issues: 「哪九个，你跟我说一
下分别问题是啥」. The Herder answered with three vague groups and 「哪条想细问，直接说编号就行」. The
nine items were in the agent's reply; the Herder was not allowed to say them. Three rules did it:

- the Herder's replies, `ask` and `notify` were held to 100 words (ADR 0049): a longer reply was
  written again, then cut;
- the voice prompt said "two or three sentences, never a list, name one or two items";
- the `friend` style, copied from open-instinct, said "Say less. Do more… usually under three
  sentences".

The owner (2026-11-10): the Herder must not have a word limit; 「不一定要少说，但是要说重点」.

How other personas handle length (texts in ADR 0053's sources):

| Product | Text |
| --- | --- |
| OpenClaw SOUL.md, moltis | "Concise when needed, thorough when it matters." |
| nanobot SOUL.md | "Keep responses short unless depth is asked for." |
| boop-agent | "No bullet dumps unless the user asked for a list." |
| nanoMuse | "When the result has a shape… build it as a file instead of a long message." |
| Vercel personal-agent template | "Concise and technically precise. No filler, no sycophancy." |
| open-instinct | "Say less. Do more… usually under three sentences." (the only count) |

None has a word cap. They limit filler, not length.

Memory had the same kind of problem. Every ended task with two transcript entries queued a `case`
job, and the experience merge ran after it. The live store held two cases about the same issue
hunt and an experience learned from a task that AgentHerd itself had stopped on restart. The
owner: 「不可能每个任务都总结一个 memory 吧」, 「这种我觉得没必要记住」.

## Decision

1. **No word limit for the Herder.** Its final reply, `ask` and `notify` are sent as written.
   The rewrite (`herder.reply.long`) and the cut are gone. Long messages are folded by the
   channel as before. Agents keep their limits (`herd_report` summary 100 words, `herd_ack` 30):
   their text is now material for the Herder.
2. **Say what matters.** Shared by all three styles: length follows what the owner asked. Just
   the result → a sentence or two. "Which ones / what is each" → every item, one sentence each,
   none left out. Important or risky → the whole of it. No filler, no steps, no 「结论：」 lines,
   no list unless asked. Far too much → what matters and where the rest is. The voice prompt
   says the same and no longer forbids lists.
3. **Style texts.** `friend` drops "Say less" and "under three sentences"; `secretary` drops
   "concise, short unless depth is asked for" for "the result first, then what the owner has to
   do; the details when they are asked for". `partner` is unchanged.
4. **Whose words are below.** The folded section under a voiced report is labeled with the
   agent's name: 「Pi 的原话」 (`ReportView.fullReplyBy`), not 「完整回复」, so the owner knows the
   card body is the Herder's and the fold is the agent's.
5. **Memory keeps lessons only.** No `case` is written any more. At task end core collects
   signals: it failed; it got stuck or blocked; the watchdog raised an alarm; its model or agent
   was switched; the owner prompted it more than once. No signal → nothing (audited
   `memory.lesson.none`). A task AgentHerd stopped, or recovered after a crash, never counts. With
   a signal, a `lesson` job asks the fast model for one lesson or `{"skip":true}` (the usual
   answer); a result, a list or a follow-up request is not a lesson. The lesson becomes an
   `experience`. Old `case` entries stay visible in the app and are no longer used for lessons.
   The owner can still say 「记住」.
6. **Earlier tasks by search.** New Herder tool `task_search(query)` finds tasks by title,
   project and last report (up to 10, most hits then newest). The prompt says task results are
   not kept in memory.

## Alternatives

- **Raise the limit (say 400 words).** Any number fails the next list of 30; the owner asked for
  no limit.
- **Keep "short" in the styles and add "unless asked".** The models followed "short" over the
  exception in testing; the rule is now about what matters, not about length.
- **Keep cases but dedupe them.** A case of a successful task is a copy of the task record,
  which is already searchable.

## Consequences

- Answers to "which ones" list every item. A careless model may write longer messages; the
  styles and the voice prompt are the only brake.
- Fewer memory jobs and model calls: most tasks end with no signal.
- Lessons can be missed when a task went wrong without any of the signals.
- The live store's two cases and the wrong experience were marked deleted by hand (restorable in
  the app).
