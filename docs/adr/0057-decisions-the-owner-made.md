# ADR 0057: The owner's decisions are kept with their words and never asked again

- Status: Accepted
- Date: 2026-11-11
- Builds on: [ADR 0038](0038-herder-memory.md) (memory), [ADR 0056](0056-leaving-the-mac-asks-and-questions-close.md) (approvals)
- Changes: [08-herder-interaction §2](../spec/08-herder-interaction.md), [04-herder](../spec/04-herder.md)

## Context

A refused step came back on the next task: approval answers and the owner's 「这个不做」 held for
one card or one task only. A Zhihu write-up of a working agent setup (安生, 2026-11-07, "Agent目前最大的瓶颈是什么？")
keeps two files in the repo, 「定了的事」 and 「定了不做的事」, each entry the owner's own words
and a date; agents read them and never ask again. Our memory already keeps the owner's lasting
preferences (`owner`), but those are about how to talk to them, not what was settled about the
work, and they did not count as allowing a step that leaves the Mac.

## Decision

1. A new memory kind `decision` 「定了的事」 holds what the owner settled for good about the work,
   decided or refused (「AgentHerd 的改动直接推 main」, 「不做 Windows 版」). It is resident (in the
   Herder's system prompt, cap 2200 characters) and shows the owner's words: `原话：「…」`.
2. Only the Herder writes it, in an owner turn, with evidence copied from what the owner typed;
   questions and ifs do not count, and the evidence needs a lasting or settling word (以后, 不做,
   定了, 一律, 直接推, …). A choice for one task is not a decision.
3. Every new task gets the decisions in its added context with their words and day
   (「负责人定了的事（照做，不要再问…）」). A decision that allows a step for the project counts as
   asked: the Herder passes it in `session_start` `allowed`.
4. The Herder hears how each approval card was answered (allowed, refused, 「先不管」, timed out) as
   an event under [Already sent to the owner]. When the same kind of step comes back, it may ask
   once whether to keep it as a decision. A card alone never becomes a decision.

## Alternatives

- Turning every refusal into a rule automatically: a tap carries no reason and no scope (this
  task, this project, always?); the owner's words do.
- Files in each repo like the article: agents would read them, but AgentHerd works across
  projects and the owner talks to the Herder, not to a repo.
- A separate reviewer model deciding what is settled: decisions come only from the owner.

## Consequences

- Fewer repeated cards and questions; the 记忆 page shows 「定了的事」 where the owner can change
  or delete them.
- A wrong decision goes to every task until removed; the evidence rule and the quote make it easy
  to see why it is there.
- One more event kind for the Herder; it costs nothing until the owner's next message.
