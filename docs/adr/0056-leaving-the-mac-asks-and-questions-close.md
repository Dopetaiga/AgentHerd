# ADR 0056: Steps that leave the Mac ask the owner; every question has a life

- Status: Accepted
- Date: 2026-11-10
- Supersedes: [ADR 0029](0029-only-mass-deletes-ask-the-owner.md) (the "only a mass delete asks" rule; the mass-delete check stays)
- Changes: [04-herder §3](../spec/04-herder.md#3-approval-pipeline), [05-channels §2](../spec/05-channels.md#2-what-the-owner-sees)

## Context

Since ADR 0029 only a mass delete reached the owner: `git push --force`, `gh pr merge`, `npm
publish` or a mail sent through an app ran without a word. Those are the steps the owner cannot
take back, because their effect leaves the computer. The nwverse/persona assistant draws the
same line in its prompts (`agents/wake.md`: push, deploy, message others, merge others' PRs are
always blocked on the user unless the task authorized that step; local branch work may go on).

Questions also never ended. An approval card reminded every 30 minutes forever ("time passing
never decides anything"); a Herder question stayed open after the owner had typed the answer in
the chat; approvals of two tasks came as two cards. Persona closes a question when the user
writes instead, moves unanswered ones out of the way, and batches approvals.

The owner (2026-11-10): 「我理解是推到外部才要问吧」; timeout 「一小时吧」; 「可以的，你继续改」.

## Decision

1. **Leaving the Mac asks.** `packages/rules/src/outbound.ts` `outboundCheck(call)` finds steps
   whose effect goes out of the computer, in seven kinds (`OUTBOUND_STEPS`):
   `push` (git push, svn dcommit), `pull-request` (gh pr create/edit/close/ready/reopen),
   `merge` (gh pr merge), `comment` (gh pr comment/review, gh issue create/comment/edit/close,
   `gh api` with a write method or fields), `publish` (npm/pnpm/yarn/bun/cargo/poetry/uv publish,
   twine upload, gem push, docker push, gh release, gh repo changes, gists), `deploy` (vercel,
   netlify, fly, wrangler, firebase deploy; kubectl apply/delete/rollout/scale/set; helm
   install/upgrade/uninstall; terraform apply/destroy; gh workflow run) and `send` (git
   send-email, mail/sendmail/mutt, lark-cli send/reply/forward, app tools whose slug has SEND,
   REPLY, FORWARD, POST, TWEET, PUBLISH, COMMENT, INVITE or SHARE). A command the parser cannot
   read asks when it mentions `git … push`, `gh pr merge` or `publish`. Everything local — edits,
   commits, branches, local merges, tests, installs, fetch/pull — never asks.
2. The pipeline escalates such a step with risk high and reason `leaves the Mac: <step>: …`,
   in every mode, whatever the owner's allow rules say. Only an owner's deny rule beats it
   (stricter than asking). The mass-delete check and `extraGuards` stay as they were.
3. **Steps the owner asked for pass, for that task only.** `session_start` takes `allowed`
   (subset of `OUTBOUND_STEPS`): the steps the owner's request itself asks for
   (「做完推上去开个 PR」 → `push`, `pull-request`). `merge` only when they said merge. They are
   kept on the task (`tasks.allowed_steps_json`, schema 14) and passed to the pipeline as
   `allowedSteps`; other steps still ask. Agents are told in the task prefix that such steps wait
   for the owner and to skip one that is refused or not answered.
4. **Approvals have a life.** One reminder after `remindMinutes` (30), then after
   `timeoutMinutes` (60) the item closes as not done: the agent gets a deny and goes on without
   that step; the card shows 「1 小时没人回，这一步没做」 and the decision is recorded with reason
   `no answer in time`. Every card has 「先不管」, which does the same at once. Time never allows.
5. **Approvals that come up together share one card.** While a card has open items, the next
   item of any session joins it: numbered lines, each with 批准/拒绝, and 「全部批准」/「都先不管」
   for all. The owner can also reply 「都批」, 「批 1、3」, 「拒 2」 in the chat
   (`parseBatchAnswer`); any other text goes to the Herder as before. One item per session is
   still open at a time.
6. **Herder questions close.** When the owner writes in the chat while a Herder question is
   open, the card closes with 「你在聊天里回了」 and the Herder gets an `ask-closed` event before
   the message: it may be the answer, do not ask again. A question nobody answers closes after
   `timeoutMinutes` with 「1 小时没人回，先放下了」 and an `ask-closed` event, held until the
   Herder's next turn: do not ask again, mention it once if it still matters.

## Alternatives

- **Keep ADR 0029 and add rules per repository.** Rules are allow-lists the owner never writes;
  the default must be safe for steps that cannot be undone.
- **Ask for every git command or every write.** Back to a card per step (the reason for 0029).
- **Default to the recommended answer at the deadline** (persona does it for reversible
  decisions). Approvals here are exactly the irreversible ones; a deadline only ever denies.
- **Let the owner allow steps by a button on the first card ("always for this task").** Possible
  later; the request text already says what the owner wants in the common case.

## Consequences

- A task that pushes or opens a pull request without being told to now stops for one tap, or
  skips the step after an hour.
- The check is by command shape: a script that pushes inside (`./release.sh`) is not seen. The
  agent's own sandbox and the owner's deny rules remain the backstop.
- A card can change shape (one item → numbered list) while the owner looks at it.
- `Inbox` holds one open card at a time; queued items of the same session still wait behind
  their predecessor.
