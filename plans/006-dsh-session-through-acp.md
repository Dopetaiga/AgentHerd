# Plan 006: A DSH session runs through ACP and its permission requests reach the owner

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat 5834bf9..HEAD -- packages/cli packages/acp-client docs/spec/03-agents.md`.
> If files changed in a way that makes "Current state" wrong, STOP.

## Status

- Milestone: M2
- Size: M
- Risk: LOW
- Depends on: plan 004, open question Q07 (closed 2026-11-04)
- Planned at: `5834bf9`, 2026-11-04

## Why this matters

M1 proved the loop with the mock agent. This plan runs the first real agent, DeepSeek Harness,
through the same loop: `agentherd run --profile dsh <dir> <prompt>` starts `dsh acp`, and every
write or network command DSH wants to run reaches the owner as a card
([03-agents.md](../docs/spec/03-agents.md#dsh-approvals)).

## Current state

- `packages/acp-client` merges partial tool call updates (`ToolCallTracker`, commit `5834bf9`),
  so DSH permission requests show the command and `rawInput.justification`.
- `packages/cli/src/main.ts` `profileFor()` knows only `mock` plus profiles from `config.json`.
- DSH is not on `PATH` on the maintainer machine; the app bundle has
  `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`.

## Scope

**In scope:**

- Built-in `dsh` profile in `packages/cli/src/profiles.ts`: command found by `findDsh()`
  (`AGENTHERD_DSH`, then `dsh` on `PATH`, then the app bundle path), env
  `DSH_PERMISSION_MODE=read-only`. A profile with the same id in `config.json` wins.
- `--profile dsh` without a found binary fails with an actionable message.
- Item card body shows `rawInput.justification` when present.
- Unit tests for `findDsh()` and profile resolution; a manual run with Feishu.

**Out of scope:**

- Stages, board, reports (plan 007). Herder (plan 008). Other agents (M4).
- Recording DSH sessions as fixtures (needs a model key in CI; later).

## Commands you will need

```bash
pnpm check
pnpm vitest run packages/cli packages/core
node packages/cli/bin/agentherd.ts run --profile dsh /tmp/dsh-try "Create out.txt containing hello using bash"
```

## Steps

### Step 1: Built-in profiles

Create `packages/cli/src/profiles.ts` with `findDsh(env, exists)` and `builtinProfiles()`;
move `mockProfile` there. `profileFor()` looks at config profiles first, then built-ins.

**Verify:** `pnpm vitest run packages/cli` → profile tests pass.

### Step 2: Justification on the card

`itemBody()` in `packages/core/src/inbox.ts` adds `Reason: <justification>` when
`toolCall.rawInput.justification` is a string (redacted, counted in the 20-line cap).

**Verify:** `pnpm vitest run packages/core` → pass.

### Step 3: Manual run

Run the command above with the Feishu binding from M1. Expected: a card with
`echo hello > out.txt` (or similar) and a reason; Allow → file exists; the session ends.

## Test plan

- Unit: `findDsh` order (env, PATH, bundle, none); config profile overrides built-in.
- Unit: item body with justification.
- Manual: the run above (DSH needs a model; not in CI).

## Done criteria

- [x] `pnpm check` and `pnpm test` pass
- [x] Manual run done and recorded in Maintenance notes
- [x] 03-agents.md DSH status updated
- [x] `plans/README.md` state updated

## STOP conditions

- DSH does not send a permission request in read-only mode on this machine.
- The card cannot show the command.

## Maintenance notes

- 2026-11-04 14:06 manual run: `agentherd run --profile dsh --mode assist /tmp/dsh-try "Create out.txt
  containing hello using bash ..."`. Sessions went starting → working → waiting-approval; the owner
  tapped Allow on the Feishu card; DSH wrote `out.txt` (`hello`), turn ended with `end_turn`,
  decision `human allow` recorded. Item title is DSH's tool name (`bash`); plan 007 may give
  titles from the command.
- The DSH profile lives in `packages/cli/src/profiles.ts` (not in a separate package); it moves
  to the desktop app's profile list in plan 009.
