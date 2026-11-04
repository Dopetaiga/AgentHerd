# Plan 011: The desktop app binds Feishu, configures models, and shows tasks and open items

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat 461a7b4..HEAD -- packages/core packages/herder packages/cli`.

## Status

- Milestone: M2
- Size: L
- Depends on: 010, ADR 0004, ADR 0021
- State: DONE (manual run pending)

## Why this matters

M2 needs a desktop app for onboarding (QR, models), a sessions list and a read-only inbox, a
mode switch and a keep-awake switch (07-delivery). The owner asked for a GUI to configure models
instead of CLI keys.

## Current state

- `agentherd start` composes Herd, Herder and the Feishu channel inside `packages/cli`.
- Model settings and keys exist (plan 010); there is no local API and no `apps/desktop`.

## Scope

- `packages/host`: `config.ts` and `profiles.ts` move here from the CLI; `Host` (owns Herd,
  Herder, channel setup, model settings, mode, keep-awake; emits status/tasks/models/setup
  events); `api.ts` (types, no runtime imports, also used by the renderer); `server.ts` (Unix
  socket `<home>/run/herd.sock`, 700/600, newline JSON, refuses a second host; `connectHost`
  client); `run.ts` (`runHost` with Feishu + keychain); `bin/host.ts`.
- `Herd.setHerder(factory)` and `Herd.setMode(mode)`: a model change rebuilds the Herder in
  place; running tasks keep going.
- CLI `start` runs `runHost`, so the app can connect to a host started in a terminal.
- `apps/desktop` (Electron 44.7.0, electron-vite 4, React 19, Tailwind 4, zustand 5):
  - main: window (context isolation, sandbox, no Node in renderer, navigation blocked), connects
    to a running host or starts `packages/host/bin/host.ts` in a `utilityProcess` (logs to
    `<home>/logs/host.log`), reconnects, IPC `host:call` limited to `HOST_METHODS`, keep-awake via
    `powerSaveBlocker`; `AGENTHERD_CAPTURE` saves screenshots for checks.
  - preload: `window.agentherd` (`src/shared/bridge.ts`).
  - renderer (Chinese): 引导 (Feishu QR, add a model service, choose the Herder's model), 任务
    (tasks with stages, open items read-only), 模型 (role card, service cards, add dialog that
    starts with the service, then key, then models; test; replace key; remove), 设置 (mode,
    keep-awake). A dev bridge with sample data runs the UI in a plain browser.
- Keys: the host keeps them in the macOS keychain (not `safeStorage`), so app and CLI share them;
  main and the renderer only pass a new key through once.
- Out of scope: tray, auto-update, packaging/signing, rules and export pages, OAuth logins, backup
  models, local endpoint detection, history page.

## Commands

- `pnpm vitest run packages/host`
- `pnpm check`
- `pnpm --filter @agentherd/desktop build`
- `pnpm --filter @agentherd/desktop start` (manual run)

## Steps

1. Host package and local API with tests. Verify: `pnpm vitest run packages/host`.
2. Herd `setHerder`/`setMode`. Verify: `pnpm vitest run packages/core`.
3. CLI `start` on `runHost`. Verify: `pnpm vitest run packages/cli`.
4. Desktop main/preload/renderer. Verify: `pnpm --filter @agentherd/desktop build` and screenshots
   with `AGENTHERD_CAPTURE`.
5. Manual run with the owner: bind (or reuse binding), add a model service, choose the Herder,
   send a plain message in Feishu.

## Test plan

- `packages/host/test/host.test.ts`: no channel → status explains; setup binds and connects;
  model keys only in secrets, Herder on/off with key; mode and keep-awake, `auto` refused;
  socket calls, events, errors and refusing a second host.

## Done criteria

- Tests, `pnpm check` and the desktop build pass; screenshots of each page look right.

## STOP conditions

- Electron's Node cannot run the host's TypeScript sources in a utility process.

## Maintenance notes

- 2026-11-04: written and implemented in one go after the owner asked for the GUI.
- 2026-11-04: secrets moved from the macOS keychain to `<home>/secrets.json` (mode 600). The
  owner did not want them in the keychain, and reading an item from a different binary (Electron
  instead of the node that saved it) raised an access prompt that, when missed, failed the
  connection with "Platform failure: User canceled the operation.". `@napi-rs/keyring` removed.
