# Plan 013: The desktop app downloads Pi on the Agent page; no terminal install

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat 0578d9e..HEAD -- packages/host apps/desktop`.

## Status

- Milestone: M2
- Size: M
- Depends on: 012, ADR 0023
- State: DONE (manual run pending)

## Why this matters

The owner should not open a terminal to get an agent (maintainer: "我不要自己装 … 他都是在gui配置的").
OpenBot downloads pinned CLIs from its Settings page; AgentHerd does the same for Pi.

## Current state

- Pi is found only via `AGENTHERD_PI` or `PATH`; the Settings page lists profile ids and says
  to run `npm i -g`.

## Scope

- `packages/host/src/runtimes.ts`: `PI_RUNTIME` pin (1.5.0, four targets), `RuntimeStore`
  (download, SHA-256, `tar -xzf`, `--version`, ready mark, rename; `remove`).
- `packages/host/src/agents.ts`: `Agents` (views, install in background with progress, cancel,
  remove; Pi path order `AGENTHERD_PI` → downloaded → `PATH`).
- Local API: `AgentView`, `agents`, `installAgent`, `cancelInstall`, `removeAgent`, topic
  `agents`; the host rebuilds profiles when the list changes.
- Desktop: new **Agent** page (state, progress, 下载/取消/移除, Pi model choice); the Agent list
  and the Pi row leave 设置 and 模型 → 用途. Dev bridge fakes downloads (`?sim=pi-failed`).
- Out of scope: Pi sign-in from the app, automatic updates of the pin, Windows, custom ACP
  agents in the GUI, downloading DSH (no published binaries).

## Commands

- `pnpm vitest run packages/host`
- `pnpm check`

## Test plan

- `packages/host/test/agents.test.ts`: a local HTTP server serves a fake `pi` tarball. Install
  checks hash and version; a wrong hash or version fails and leaves nothing; an unsupported
  target fails; the host adds `pi` to the profiles after install and drops it after remove; a
  404 shows the error on the view.
- Real download 2026-11-04 of `pi-darwin-arm64.tar.gz` via `RuntimeStore`: 41 s, hash and
  `--version` 1.5.0 passed.

## Done criteria

- Pressing 下载 on the Agent page makes `/run pi …` work without a terminal.

## STOP conditions

- The release hash differs from the pin (upstream replaced an asset): stop, do not update the
  pin without checking.

## Maintenance notes

- To move to a new Pi release: take `digest` and `size` of each asset from
  `gh api repos/earendil-works/pi/releases/tags/<tag>`, update `PI_RUNTIME`, and run a real
  download once.
