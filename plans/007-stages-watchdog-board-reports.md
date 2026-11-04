# Plan 007: Tasks have stages, a watchdog, a pinned board and completion reports

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat 9076f45..HEAD -- packages/core packages/channel-feishu docs/spec/04-herder.md docs/spec/05-channels.md`.
> If files changed in a way that makes "Current state" wrong, STOP.

## Status

- Milestone: M2
- Size: L
- Risk: MEDIUM
- Depends on: plan 006
- Planned at: `9076f45`, 2026-11-04

## Why this matters

The owner should see every task without asking: one pinned board that changes in place, a
report when a task ends, and a message when a task is stuck
([04-herder.md §2](../docs/spec/04-herder.md#2-following-tasks), [ADR 0019](../docs/adr/0019-relay-verbatim-board-and-reports.md)).
Following tasks is code; the Herder (plan 008) is woken only by its results.

## Current state

- `Herd.run()` in `packages/core/src/herd.ts` runs one prompt and returns; nothing is sent when
  the turn ends.
- `renderCard()` in `packages/channel-feishu/src/card.ts` renders the board as plain lines and
  the report without folding.
- The prototype `feishu-proto/board.ts` showed a pinned table card can be patched in place.

## Scope

**In scope:**

- `packages/core/src/tasks.ts`: `Task`, `taskTitle()`, `projectName()`, `stageOf()`,
  `sortForBoard()`.
- `packages/core/src/board.ts`: `Board` sends and pins one board card, then updates it in
  place; updates are coalesced (`boardDebounceMs`, default 1000).
- `packages/core/src/report.ts`: `reportBody()` (≤ `reportMaxChars` verbatim; longer → one
  summary turn; fallback to the reply), `reportView()`, `replyHint()`, `summaryPrompt()`.
- `packages/core/src/watchdog.ts`: repeated tool call (3 in a turn), quiet time
  (`maxQuietMinutes`, not counted while waiting for the owner), agent exit.
- `Herd.run()` follows the task: reply hint before the owner's words, stages from session
  state, board updates, report at the end, watchdog alarms sent to the owner (no Herder yet),
  rule decisions listed in the report, item cards labeled with the task title.
- Owner message `status` sends the board again and pins it.
- Feishu: board as a `table` component; report folded over 600 characters with a
  `collapsible_panel`, "Full reply" panel when summarized.

**Out of scope:**

- `herd_report` MCP tool (needs an MCP server per session; Q14). Stages use session state only.
- "3 turns with no file change" watchdog rule (needs multi-turn sessions from plan 008).
- Storing tasks in `herd.db` (tasks live in memory until plan 008 adds long-lived sessions).
- Relay, select menu under the board, daily digest (plan 008 and later).

## Steps

### Step 1: Pure modules

Write `tasks.ts`, `report.ts`, `watchdog.ts`, `board.ts` with unit tests.

**Verify:** `pnpm vitest run packages/core` → pass.

### Step 2: Follow tasks in `Herd.run()`

Wire the modules into `Herd`. The quiet timer pauses while the session is `waiting-approval`.
A finished turn is `done` even after an alarm; a session that was in `error` stays `failed`.

**Verify:** `pnpm vitest run packages/core/test/e2e` → E2E-REPORT-SHORT, E2E-REPORT-LONG,
E2E-BOARD, E2E-WATCHDOG, E2E-STATUS and the M1 scenarios pass.

### Step 3: Feishu cards

Board table and folded report in `card.ts`, with tests.

**Verify:** `pnpm vitest run packages/channel-feishu` → pass.

### Step 4: Manual run

`node packages/cli/bin/agentherd.ts run --profile dsh /tmp/dsh-try "<task>"`. Expected: a pinned
board that changes from working to done, the item card labeled with the task, and a report.

## Test plan

Unit tests per module; E2E scenarios above in `packages/core/test/e2e/follow.e2e.test.ts`.

## Done criteria

- [x] `pnpm check` and `pnpm test` pass
- [x] Manual run done and recorded below
- [x] 07-delivery E2E table updated
- [x] `plans/README.md` state updated

## STOP conditions

- Feishu rejects the table card or the pinned update in the manual run.
- The summary turn cannot be told apart from the task turn in ACP updates.

## Maintenance notes

- 2026-11-04 14:19 manual run with DSH and Feishu: board card sent and pinned (`board.sent`),
  item card answered by the owner, DSH wrote `notes.txt`, report sent (`report.sent`,
  `summarized: false`), no `board.error` or `report.error`. How the owner sees the pinned board
  and in-place updates on the phone is still Q13.
- `stageOf()` puts a finished turn before an alarm: an earlier watchdog alarm does not make a
  task that ended normally `stuck`. A session that was in `error` stays `failed`.
- Feishu board and report rendering and the unit tests for tasks, report, watchdog and board
  were written by DeepSeek V4 Pro subagents and reviewed.
