# Plan 014: Six agents downloaded at their latest release, and a 验证 button

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat ff47fd7..HEAD -- packages/host packages/acp-client apps/desktop`.

## Status

- Milestone: M2
- Size: L
- Depends on: 013, ADR 0024
- State: DONE (manual run pending)

## Why this matters

The maintainer wants more agents in the same GUI flow ("类似的，再搞几个agent？"; chose OpenCode,
Gemini CLI, Claude Code, Codex), DSH downloadable too ("dsh也应该是下载这种形式啊"), and a check
button ("还有就是加一个验证的按钮").

## Current state (before)

- Only Pi downloadable, at a version pinned in code (ADR 0023). DSH only via its app or `PATH`.
- No way to see whether an installed agent starts and is signed in, short of running a task.

## Scope

- `packages/host/src/catalog.ts`: `AGENTS` (dsh, pi, opencode, gemini, claude, codex) with
  `envVar`, `systemNames`, `acpArgs`, ask-first `env`, `latest(target, fetchers)`;
  `githubAsset`, `npmLatest`, `npmRuntime`, `parseDshFeed` (electron-builder YAML with folded
  values), `agentProfile` (scripts run with `process.execPath` + `nodeEnv()`), `httpFetchers`.
- `packages/host/src/runtimes.ts`: `Release` = `ArchiveRelease` (tar.gz/zip, sha256/sha512
  hex/base64, `check` exec/node/none) | `NpmRelease`; `RuntimeStore.install(release, {onProgress,
  signal, npmCli})`, `installed(id)` via `current.json`, `remove(id)`; `describeFailure`.
- `packages/host/src/agents.ts`: generic `Agents` (`find(id)`, `views`, `install`, `cancel`,
  `remove`); npm agents first install the `npm` runtime.
- `packages/host/src/profiles.ts`: `findAgent(id)`, `builtinProfile`, generic `resolveProfile`
  and `availableProfiles` (`find` option replaces `findDsh`/`findPi`).
- `packages/host/src/verify.ts`: `verifyProfile(profile, {timeoutMs, start})` →
  `AgentCheck {ok, needsLogin, agentName, agentVersion, authMethods, error, ms}`;
  `Host.verifyAgent(id)`; `verifyAgent` in `HOST_METHODS`.
- `packages/acp-client`: `AgentConnection.agentVersion`, `authMethods`; `StartOptions.signal`;
  SIGKILL `CLOSE_GRACE_MS` (3 s) after SIGTERM, also when `initialize` fails.
- CLI `run --profile <id>` finds the app's downloads first.
- Desktop Agent page: six rows, 下载 / 更新 / 取消 / 移除, 验证 with result line, sign-in hints;
  dev bridge fakes all six.

Out of scope: periodic update checks, a blocklist, Windows, signing in from the GUI.

## Verify

- `pnpm test` — host `agents.test.ts` (RuntimeStore tar.gz + zip + update, digest, version,
  npm needed; DSH feed parse; profiles; Host install/remove/fail; verify ok/login/timeout) and
  acp-client SIGKILL tests pass.
- `pnpm check` clean.
- Real run 2026-11-05 on macOS arm64: OpenCode 1.19.5 and Gemini 0.66.0 downloaded in 54 s;
  Codex 2.5.0 installed with npm 12.2.1; 验证: DSH ok (`deepseek-harness-acp`, 0.7 s), Gemini needs
  sign-in (4 methods), OpenCode and Codex errors shown with their stderr.

## Done criteria

- All six agents appear on the Agent page; each downloadable one installs its latest release.
- 验证 shows ok / needs sign-in / error within 60 s and leaves no process behind.

## STOP conditions

- A publisher stops listing a digest (GitHub `digest`, npm `integrity`, feed `sha512`).
- An agent's ACP flag changes (`opencode acp`, `gemini --acp`).

## Maintenance notes

- On this Mac, endpoint security kills some native binaries (Claude's `claude`, Codex's `codex`,
  unsigned Gemini) with SIGKILL; 验证 reports it. Not an AgentHerd bug.
- DSH's feed is the `nightly` channel (the only one published); stagingPercentage is ignored.
