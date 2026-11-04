# Plan 009: The Herder answers the owner, starts tasks from chat, and never approves

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat eed1637..HEAD -- packages/core packages/herder-loop packages/channel-feishu packages/cli docs/spec/04-herder.md`.
> If files changed in a way that makes "Current state" wrong, STOP.

## Status

- Milestone: M2
- Size: L
- Depends on: 005 (herder-loop), 008 (long-lived tasks, relay, commands)
- State: DONE in code and tests; manual Feishu run pending (needs a model key)

## Why this matters

Until now a plain message got the list of commands. The owner should be able to write "在
agentherd 里把测试跑一下" and get a task, a question when something is unclear, and an answer
about what is running, without learning commands. The Herder must not be able to approve
anything, and what the agent receives must be the owner's words, not the Herder's retelling
(ADR 0018, ADR 0019, docs/spec/04-herder.md §1–§3).

## Current state

- `packages/core/src/herd.ts` sends `texts.noHerder` for plain text without a relay and for
  `/herder`. `/run` sends nothing until the first card.
- `packages/herder-loop` holds Pi's loop (`Agent`, `beforeToolCall`, tools as `AgentTool`).
- pi-ai 1.5.0 knows `deepseek/deepseek-flash` and `deepseek/deepseek-v4-pro`; keys come from
  `getEnvApiKey(provider)` (`DEEPSEEK_API_KEY`).

## Scope

In:

- `packages/core/src/herder-port.ts`: `HerderHost` (what the Herd lets the Herder do; nothing
  answers an item), `HerderPort`, `HerderEvent`, `HerderFactory`. The core does not import the
  Herder or pi-ai; the CLI passes the factory (`HerdOptions.herder`).
- Herd: plain text without relay and `/herder <text>` go to the Herder; the Herder's questions
  are `AskView` cards with buttons; a tap goes back to the Herder; task reports and watchdog
  alarms are Herder events; `/run` answers at once (`runAccepted`).
- `packages/herder`: system prompt, tools, `Herder` class (serial queue, batched events, session
  saved in the `state` table under `herder.messages`, rollback on model error).
- Tools: `session_list`, `decisions_list`, `session_start`, `session_prompt`, `session_cancel`,
  `relay_start`, `relay_end`, `ask`, `notify`.
- Verbatim rule enforced in code: `session_start.ownerText` must be part of the owner's message;
  the agent gets `[Owner's message]` + the owner's words + `[Context added by the Herder, for
  reference]`. `session_prompt` text that is not the owner's words is labeled `[Message from the
  Herder, not from the owner]`. Event turns cannot start tasks, prompt or start relays.
- Guard: every Herder tool call is audited (`herder.tool`); a `session_start` whose directory hits
  the guard list is blocked and the owner is told (`herderGuardHit`).
- CLI: config `herder {provider, model}` (default `deepseek/deepseek-flash`), key from the
  provider's environment variable or the keychain (`herder:<provider>`), `agentherd setup herder`
  reads the key from stdin. Without a key `start` runs with commands only.
- Feishu card for `ask`.

Out (follow-ups): `task_get`, `session_transcript`, `read`, `grep`, `list`, `git_log`,
`git_diff`; `maxConcurrentSessions` queue; compaction (M3); digest.

## Commands

- `pnpm vitest run packages/herder packages/core packages/cli`
- `pnpm check`

## Steps

1. Add `herder-port.ts` and wire it into `herd.ts` (factory, `toHerder`, `ask`/`onAskAnswer`,
   `cancelTurn`, events from `sendReport` and `onAlarm`, `runAccepted`).
   Verify: `pnpm vitest run packages/core` passes.
2. Add `AskView` to protocol and the Feishu `ask` card.
   Verify: `pnpm vitest run packages/channel-feishu` passes.
3. Write `packages/herder` (prompt, tools, herder) with unit tests using a fake host.
   Verify: `pnpm vitest run packages/herder/test/tools.test.ts packages/herder/test/herder.test.ts`.
4. E2E with pi-ai's faux provider, a real Herd and the mock agent.
   Verify: `pnpm vitest run packages/herder/test/e2e` passes.
5. CLI wiring and `setup herder`.
   Verify: `pnpm vitest run packages/cli` and `pnpm check` pass.
6. Manual run: `DEEPSEEK_API_KEY=... node packages/cli/bin/agentherd.ts start`; in Feishu send a
   plain message asking for a task in a known project, answer one question card, ask "现在在跑什么",
   ask the Herder to approve an open item (it must refuse).

## Test plan

- Unit (`packages/herder/test/tools.test.ts`): verbatim check, project resolution, labels,
  refusals in event turns.
- Unit (`packages/herder/test/herder.test.ts`): final text to owner, ask flow, failure rollback and
  message, event batching, events cannot start tasks, guard blocks `~/.agentherd`, session saved
  and reloaded, save cut at a user message.
- E2E-RUN-FROM-CHAT and E2E-HERDER-NO-APPROVE (`packages/herder/test/e2e/herder.e2e.test.ts`).

## Done criteria

- All tests and `pnpm check` pass.
- No Herder tool or host method can answer an item (review `HerderHost`).
- Manual run as in step 6.

## STOP conditions

- The model needs a tool that would let it answer an item or run commands.
- pi-ai must be patched.

## Maintenance notes

- 2026-11-04: code and tests done (551 tests). The Herder's model key is never asked for in chat.
- Owner decisions are rows in `decisions` with source `human`; the E2E checks that.
- 2026-11-04: the model setup (config `herder`, default `deepseek/deepseek-flash`, `setup herder`)
  was replaced by the model list of [plan 010](010-model-list-and-roles.md) / ADR 0021. Manual
  run: choose a model with `agentherd model` first.
