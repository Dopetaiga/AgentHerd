# ADR 0052: Offer new GitHub work only when the owner asks

- Status: Accepted
- Date: 2026-11-08
- Builds on: [ADR 0047](0047-follow-the-pull-requests-tasks-open.md), [ADR 0048](0048-watch-mail-only-when-asked.md), [ADR 0050](0050-tell-the-owner-when-a-source-stops.md)

## Context

AgentHerd starts work only from the owner's Feishu messages. New work also arrives on GitHub:
an issue assigned to the owner, a pull request waiting for their review. The super-agent
prototype turns such events into candidate work and lets a policy decide whether to start or
ask. The owner chose (2026-11-08): GitHub only for now; by default ask with 「开任务 / 忽略」;
the owner can tell the Herder that some kinds start by themselves; nothing runs until they ask,
like mail.

## Decision

- A **new-work watch** (`IntakeWatch`, table `intake_watches`, schema 12) is one of
  `issues` (open issues assigned to the owner, `gh search issues --assignee=@me`) or `reviews`
  (open pull requests requesting their review, `gh search prs --review-requested=@me`),
  optionally limited to a repository and a label, with the owner's words for it and `auto`.
- Only the Herder creates, changes and removes watches (`intake_watch`, `intake_unwatch`), and
  only in an owner turn; an event or the work a watch offered cannot. Asking again for the same
  kind/repository/label only changes `auto`. `session_list` lists watches.
- Core `Intake` (`packages/core/src/intake.ts`) searches every 5 minutes, only while a watch
  exists. Creating a watch searches once: a missing or logged-out `gh` fails there, and items
  already present are not offered. Failures go to source health as `github` (ADR 0050).
- A new item is offered once, as a question card with the item's link and the buttons
  「开任务」「忽略」. The answer is handled by core, not the Herder: the card shows the choice,
  「忽略」 does nothing else, 「开任务」 gives the Herder an **intake turn** with one line
  naming the item. Offers survive restarts (kept with the watch, at most 20 unanswered).
- With `auto`, the owner gets one line 「按你的规则开工：…」 and the Herder gets the intake turn
  at once.
- An intake turn may start a task (it is the owner's choice or rule), but the item's title is
  someone else's words: it is quoted as untrusted, only the repository name counts as named for
  picking the project without asking (ADR 0043), and it cannot create or change watches. When
  no single project matches, the Herder asks the owner as usual. The task's prompt carries the
  item's link, so ADR 0051 follows the pull request.

## Consequences

- Owners who never ask see nothing and nothing polls GitHub for them.
- Group chats and other sources are not intake sources; adding one means another watch kind
  with the same offer path.
- Rules are coarse (kind, repository, label, auto). Finer policy, such as by author or by
  words in the title, is left until owners need it.
