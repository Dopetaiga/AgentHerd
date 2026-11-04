# Plan 008: Tasks stay open, the owner starts and relays to them from chat with fixed commands

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat d782a1a..HEAD -- packages/core packages/channel-feishu packages/cli docs/spec/04-herder.md docs/spec/05-channels.md`.
> If files changed in a way that makes "Current state" wrong, STOP.

## Status

- Milestone: M2
- Size: L
- Risk: MEDIUM
- Depends on: plan 007
- Planned at: `d782a1a`, 2026-11-04

## Why this matters

The Herder (plan 009) needs tasks it can start, prompt and relay to. These are code, not model
work, and the owner must be able to use them without a Herder model
([04-herder.md §6](../docs/spec/04-herder.md#6-model-providers): "Without a Herder model, the
owner uses fixed commands and the board"). This plan builds that part first, so plan 009 only
adds the model and its tools on top.

## Current state

- `Herd.run()` in `packages/core/src/herd.ts` starts an agent, runs one turn, sends the report
  and closes the agent. There is no way to send a second prompt.
- `Herd.handle()` knows only `status` and card actions for items. Other owner messages are
  ignored (`inbound.ignored`).
- The CLI has `setup feishu`, `run`, `status`. Nothing stays running to receive chat commands.

## Scope

**In scope:**

- Long-lived tasks in `Herd`: `startTask(profileId, cwd, ownerText)` returns after
  `session/new` and runs the first turn in the background; `promptTask(taskId, text)` (queued
  while a turn runs); `interruptTask(taskId, text)` (cancel, then prompt); `endTask(taskId)`.
  A task with no turn for `sessionIdleMinutes` (default 60) is ended. `run()` stays and is
  `startTask` + wait for the first turn + `endTask`.
- Every turn that ends sends a completion report, except turns during a relay (below). The reply
  hint goes only with the first prompt.
- `packages/core/src/commands.ts`: `parseCommand(text)` for `status`, `/help`, `/run <agent>
  <dir> <task>`, `/relay <task>`, `/end`, `/interrupt <text>`, `/herder <text>`; anything else is
  plain text. Task text after the directory is kept verbatim, including new lines.
- Relay ([04-herder.md §1 Relay](../docs/spec/04-herder.md#relay)): one active relay per owner,
  stored in `herd.db` (`state` table, key `relay`). Start: `/relay <task>` (matches task id
  prefix or title words; more than one match → the owner gets the list) or the "Relay to this
  task" button on a report. During a relay: plain text goes to the task verbatim; the agent's
  reply comes back as a text message with the task label (folded by the channel); no summary
  turn. End: `/end`, the "End relay" button, the task ends, or `relayIdleMinutes` (default 30)
  with no owner message. Start and end send a `RelayView`.
- Plain text with no relay and no Herder: the owner gets a short help text with the commands.
- Feishu: report card gets a "Relay to this task" button (`action: relay`, `target: taskId`);
  relay card gets an "End relay" button (`action: end-relay`); text messages over
  `FOLD_CHARS` are folded like reports.
- CLI `agentherd start`: connects the channel, stays running, and handles the commands above
  until Ctrl-C. Profiles are the built-in ones (`mock`, `dsh`) plus `config.json` profiles.

**Out of scope:**

- The Herder model, its tools, `/herder` doing anything except "No Herder model configured"
  (plan 009).
- Board select menu, "Full transcript" button, daily digest.
- `maxConcurrentSessions` queueing (plan 009, where the Herder starts tasks).
- Restoring tasks after a restart (sessions are not resumed; tasks of a stopped Herd are
  marked ended).

## Steps

### Step 1: `commands.ts`

Pure parser with unit tests.

**Verify:** `pnpm vitest run packages/core/test/commands.test.ts` → pass.

### Step 2: Long-lived tasks

Refactor `Herd.run()` into `startTask` / `promptTask` / `interruptTask` / `endTask`. Reports per
turn. `sessionIdleMinutes` timer on the injected clock.

**Verify:** `pnpm vitest run packages/core` → existing M1 and plan 007 E2E tests still pass.

### Step 3: Commands and relay in `Herd.handle()`

Owner-only (non-owner messages and actions are dropped and audited, as in M1). Relay state in
`herd.db`.

**Verify:** new E2E tests in `packages/core/test/e2e/relay.e2e.test.ts`: E2E-RUN-COMMAND,
E2E-RELAY (verbatim text in, reply out with label, `/end`, idle end), E2E-INTERRUPT,
E2E-RELAY-BUTTON (report button starts a relay), E2E-HELP.

### Step 4: Feishu buttons and folding

`card.ts` and `inbound.ts` changes with tests.

**Verify:** `pnpm vitest run packages/channel-feishu` → pass.

### Step 5: CLI `start` and manual run

`node packages/cli/bin/agentherd.ts start`, then in Feishu:
`/run dsh /tmp/dsh-try Create notes.txt with three facts about goats`, tap Allow, then tap
"Relay to this task", send "Add a fourth fact", then `/end`.

## Test plan

Unit tests for `commands.ts`; E2E scenarios above with the mock agent and the fake channel;
Feishu card tests; the manual run.

## Done criteria

- [x] `pnpm check` and `pnpm test` pass
- [x] Manual run done and recorded below
- [ ] 07-delivery E2E table and 04-herder / 05-channels updated
- [x] `plans/README.md` state updated

## STOP conditions

- The DSH session cannot take a second prompt after `end_turn` in the same ACP session.
- Feishu rejects the button on the report card.

## Maintenance notes

- 2026-11-04 15:01 manual run with `agentherd start`, DSH and Feishu: `/help` answered, `/run dsh
  /tmp/dsh-try ...` started a task (board sent, item allowed by the owner, report sent), the
  "Relay to this task" button started a relay and `/end` ended it. A plain message during the
  relay was not tried by hand; E2E-RELAY covers it. Retry after the Chinese texts change.
- The owner asked for Chinese texts in the channel (2026-11-04). Next change.
- `parseCommand`, the `state` table and the Feishu buttons and text folding were written by
  DeepSeek V4 Pro subagents and reviewed.
