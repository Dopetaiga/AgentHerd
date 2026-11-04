# Plan 015: The Herder picks the model of each task

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat c48b5a9..HEAD -- packages/core packages/herder packages/host`.

## Status

- Milestone: M2
- Size: M
- Depends on: 014, ADR 0025
- State: DONE (manual run pending)

## Why this matters

Maintainer: "应该让主管自己挑模型", "这个规则不急，先能挑选". Pool = every model in the list; the
Herder judges; it does not ask first and says which agent and model it chose.

## Scope

- `packages/herder/src/agent-models.ts`: `agentModelEnv(agentId, model, key)`,
  `modelChoices(settings, agentIds)`, `modelEnvFor(settings, secrets, agentId, ref, env)`.
- Core: `AgentModels` (`list`, `envFor`) in `HerdOptions.agentModels`; `startTask(…, model?)`;
  `Task.model`; task agent label "Name · service/model"; `HerderHost.models()`; audit
  `session.started` records the model.
- Herder: `session_list` lists models; `session_start.model` validated against the list; system
  prompt rule.
- Host passes `agentModels` to the Herd; `RuntimeStore` still finds a Pi downloaded by plan 013
  (no `current.json`).

Out of scope: selection rules (cheap vs strong), `/run --model`, a model column on the desktop
Agent page, ACP `session/set_model`.

## Verify

- `pnpm test`: `packages/herder/test/agent-models.test.ts`, the session_start model test in
  `packages/herder/test/tools.test.ts`, `packages/core/test/e2e/model.e2e.test.ts`
  (E2E-MODEL-PER-TASK), legacy Pi lookup in `packages/host/test/agents.test.ts`.
- Real smoke 2026-11-05 with `deepseek/deepseek-flash`: Pi (downloaded copy) and OpenCode 1.19.5
  each asked before writing, wrote `hi.txt`, and named the model in the reply.

## STOP conditions

- OpenCode stops reading `OPENCODE_CONFIG_CONTENT` or `{env:…}` in it.

## Maintenance notes

- OpenCode's own data dir on this Mac has a broken database ("Database is not empty and has no
  session table"); the smoke used a temporary `XDG_DATA_HOME`. The owner may need to move
  `~/.local/share/opencode` aside.
