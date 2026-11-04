# Plan 012: Pi joins next to DSH through a bundled ACP bridge with an approval gate

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat 608e372..HEAD -- packages/acp-client packages/host packages/herder`.

## Status

- Milestone: M2
- Size: M
- Depends on: 011, ADR 0015, ADR 0022
- State: DONE (manual run pending)

## Why this matters

The owner wants DSH and Pi as the first agents (like OpenBot). DSH speaks ACP already. Pi has
only an RPC mode and never asks before a tool call, so without a gate it would write and run
commands without the owner.

## Current state

- Built-in profile `dsh` only, found on `PATH` of the process (an app opened from Finder has a
  short `PATH`).
- The core talks ACP only (ADR 0015).

## Scope

- `packages/pi-acp`: ACP agent `bin/pi-acp.ts` → `pi --mode rpc --no-session -e gate.ts`;
  `extension/gate.ts` asks before every tool except reads inside the folder;
  `extension/model.ts` registers the owner's model from `AGENTHERD_PI_MODEL` /
  `AGENTHERD_PI_KEY`; `src/rpc.ts` (LF-only JSONL), `src/map.ts`, `src/bridge.ts`.
- Host: `findPi`, `piProfile`, `searchPath` (login shell `PATH` + usual install folders),
  `nodeEnv` (Electron runs scripts with `ELECTRON_RUN_AS_NODE=1`); model role `pi`;
  `piModelEnv` in `packages/herder`; `Herd.setProfiles` so a new Pi model applies to the next
  task.
- Desktop: Pi row in 模型 → 用途; Agent hint mentions Pi. CLI: `model use pi`.
- Out of scope: installing Pi for the user (OpenBot downloads pinned CLIs), Pi sign-in from the
  app, Pi's model list, custom ACP agents in the GUI.

## Commands

- `pnpm vitest run packages/pi-acp packages/host packages/herder`
- `pnpm check`

## Steps

1. Write ADR 0022. Verify: listed in `docs/adr/README.md`.
2. Write `packages/pi-acp` with a fake RPC Pi that loads the real gate. Verify: bridge tests
   pass (allow, deny, reads inside/outside the folder, cancel, model error, start failure).
3. Host and herder wiring. Verify: profiles and host tests pass.
4. Desktop and CLI. Verify: `pnpm check` clean.
5. Manual: install Pi (`npm i -g @earendil-works/pi-coding-agent`), choose a Pi model in the
   app, `/run pi <dir> <task>` in Feishu, approve and deny one write each.

## Test plan

- `packages/pi-acp/test/bridge.test.ts` drives the real bridge through `startAgent`.
- `packages/pi-acp/test/unit.test.ts`: gate, mapping, LF splitting, command resolution.
- `packages/host/test/profiles.test.ts`, `host.test.ts`; `packages/herder/test/models.test.ts`.
- Smoke 2026-11-04 with real Pi 1.5.0 and DeepSeek through `startAgent`: allow wrote the file,
  deny blocked `write` and `bash`; model from `AGENTHERD_PI_MODEL` worked.

## Done criteria

- `/run pi` starts a Pi task whose writes and commands reach the owner as items.
- The key never appears on a command line or in config.json.

## STOP conditions

- Pi changes its RPC events or extension API so the gate cannot block a call.

## Maintenance notes

- Pi's RPC framing is strict LF JSONL; do not use `readline` (it splits on U+2028/2029).
- Pi's `bin` is a `#!/usr/bin/env node` script; the bridge runs it with the bridge's own Node
  (`piCommand`) so a Finder-launched app does not need `node` on `PATH`.
