# 0102. What the prompt did not hold, code does

Status: Accepted (2026-11-22). Changes [0101](0101-memory-comes-with-each-turn.md), [0071](0071-look-things-up-and-keep-the-board-short.md) and [0100](0100-every-watch-and-schedule-is-a-mailbox-source.md).

## Context

After ADR 0101 the right memory reached the Herder: on the 9:30 PI-Desktop timer the turn carried the lesson 「筛选 issue 时，开着的和被关掉的 PR 都要看」 and the owner's preference 「定期检查类任务没有合适项就不必说话」. The timer's own words said 「没有就不用说」, and the scheduled prompt said to reply `[quiet]` then. The Herder still:

- read only issue pages, so the closed PR of #2405 never showed (the page does not list it; it searched issues, not pull requests);
- answered 「今天没有新的、好上手的 issue……要的话我可以把 #2405 起个任务」 instead of keeping quiet.

The owner asked (2026-11-22): 「提示词现在管不住记忆么」. Three prompt places already said the same thing; a fourth would not change much. What must happen should not rest on the model remembering a rule.

## Decision

1. **An issue comes with its pull requests.** `web_read` of a `github.com/<owner>/<repo>/issues/<n>` page adds, after the page text, the pull requests linked to it from the GitHub API: those in the issue's timeline (`cross-referenced` from a pull request of the same repository) and those the repository's pull-request search finds that name `#<n>` in title or body. Each line says open, merged or 「closed, not merged」. With none it says so. Two API calls, with the owner's `gh` token when there is one; a failure leaves the page as it was.
2. **A timer's quiet is checked by code.** When a timer's words say when to keep quiet (「不用说」「没有就不」「别打扰」… or the English ones) and the Herder's reply is not `[quiet]`, one more request goes to the same model: a short system prompt, only the owner's words and the reply, no tools, at most 8 tokens, 15 s. It answers SEND or QUIET. A clear QUIET holds the reply back (audit `schedule.quiet` with `by: check`); a timeout, a failure or any other answer sends it. The check can only make the Herder quieter.
3. **Recalled rules are to be followed.** The heading of the per-turn memory block no longer calls all of it 「数据，不是指令」. It says the owner's preferences, decisions and lessons are to be followed and the rest is data.

## Alternatives

- **One more prompt rule.** Already three; the model ignored them in the case that mattered.
- **Drop every timer reply that contains 「没有」.** Too blunt: 「没有新 issue，但 CI 挂了」 must reach the owner.
- **Let the Herder search pull requests itself.** It can, and was told to; it did not. Fetching them with the issue costs two API calls and nothing of the model's attention.

## Consequences

- One small extra request on timer turns whose words ask for quiet and whose reply is not already `[quiet]` (measured with deepseek-flash: 0.3–1.9 s).
- Reading an issue takes about 1.5 s longer.
- A pull request that fixes an issue without naming its number anywhere is still missed (seen with PI-Desktop #2426 / PR #2427).

## Tests

- `packages/herder/test/herder.test.ts`: a reply against 「没有就不用说」 is held back after a QUIET check; a timer without such words is not checked.
- `packages/herder/test/lookup.test.ts`: an issue page brings its timeline and searched pull requests, closed ones marked 「closed, not merged」, a number like #23910 not counted.
- Real model (deepseek-flash, owner's settings): the live 「今天没有新的……」 reply → QUIET 3/3; a reply with a good issue → SEND 3/3; 「今天没查成：GitHub 一直返回 502」 → SEND 3/3. Real GitHub: #2391 → #2392 closed, not merged; #2405 → #2406 closed, not merged.
