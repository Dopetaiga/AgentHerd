# ADR 0051: Keep following pull requests after they close, and those the owner hands over

- Status: Accepted
- Date: 2026-11-08
- Amends: [ADR 0047](0047-follow-the-pull-requests-tasks-open.md) ("End" and "Which")

## Context

ADR 0047 ended a pull request's watch when it merged or closed. Reviewers often comment after a
merge ("why was this renamed?", "this broke X"); those comments no longer reached the task, and
the owner had to find the task and forward them by hand. super-agent keeps a ticket's
subscriptions after it ends and keeps polling for two weeks.

ADR 0047 also followed only pull requests the task itself opened. When the owner asks a task to
follow up on someone else's pull request (「跟进一下 https://github.com/acme/app/pull/3」), its
review comments did not reach the task either.

## Decision

- **After merge or close** the owner is told once, as before, and the watch stays: `pr_watches`
  keeps `closed` (`merged` | `closed`) and `activeAt` is set to the close. People's comments still
  wake the task (an ended task is started again, ADR 0039); the prompt says the pull request is
  already merged or closed, so code changes go to a new branch and pull request while a question
  is answered on the old one. Failed checks of a closed pull request are ignored. A reopened pull
  request is told once (「PR #n 重新打开了。」) and followed as open. The watch ends after 14 days
  without activity, as every watch does.
- **Handed over**: links `https://github.com/<owner>/<repo>/pull/<n>` in what the owner sends a
  task (the request that starts it, and later prompts from the owner or the Herder on their
  behalf) are followed for that task, whoever opened them and in any state; the watch has
  `handed: true` and its prompt says 「主人让你跟进的 PR」. A pull request already followed for
  another task moves to this one. Links in the agent's own reply still count only when the task
  opened the pull request. The Herder is told to put the full link in the prompt when the owner
  hands a pull request over.

## Consequences

- One more poll per closed pull request for up to 14 days; `gh` calls stay small.
- The owner does not have to forward late review comments.
- AgentHerd's own prompts (pull request activity) never hand over a pull request, so a comment
  linking another pull request does not make the task follow it.
