# Plan 016: A model guide for the Herder, editable on the 主管 page

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat 22a7b15..HEAD -- packages/herder packages/host apps/desktop`.

## Status

- Milestone: M2
- Size: S
- Depends on: 015, ADR 0026
- State: DONE (manual run pending)

## Why this matters

Maintainer: "需要一个skill什么的提醒，就比如说现在的模型排名，opus最强，其次是谁". Chosen: built-in
default, editable on the 主管 page; no price data.

## Scope

- `packages/herder/src/model-guide.ts`: `DEFAULT_MODEL_GUIDE`, `effectiveModelGuide(text)`.
- Herder: `HerderOptions.modelGuide`, `herderTools(host, turn, modelGuide)`, `session_list`
  appends the guide after the models; `herderFromSettings(…, modelGuide)`; prompt rule.
- Host: `config.json` `modelGuide`; `modelGuide()`, `setModelGuide()` in `HostApi` and
  `HOST_METHODS`; the Herder factory reads the config at each call.
- Desktop: `components/ModelGuide.tsx` on the 主管 page (保存, 恢复默认, badge 默认/你改过);
  dev bridge fake.

## Verify

- `pnpm test`: guide test in `packages/herder/test/tools.test.ts`, host test "keeps the owner's
  model guide and goes back to the default".
- `pnpm check` clean; screenshot of the 主管 page shows the guide.

## Maintenance notes

- Update `DEFAULT_MODEL_GUIDE` (and its date) when the model field changes.
