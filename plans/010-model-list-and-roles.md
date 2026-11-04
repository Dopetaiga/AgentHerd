# Plan 010: The owner keeps a list of model services and chooses the model of each role

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat 10cc94e..HEAD -- packages/core packages/herder packages/cli`.
> If files changed in a way that makes "Current state" wrong, STOP.

## Status

- Milestone: M2
- Size: M
- Depends on: 009, [ADR 0021](../docs/adr/0021-model-list-then-choose-per-role.md)
- State: DONE (manual run pending)

## Why this matters

Plan 009 hard-coded `deepseek/deepseek-flash` as the Herder's model and kept one key per
provider. The baseline says the owner chooses models and there is no default, and owners use
third-party endpoints. The desktop settings page needs a data layer it can share with the CLI.

## Current state

- `packages/cli/src/herder.ts` (plan 009): `HerderConfig {provider, model}`, `DEFAULT_HERDER`,
  key account `herder:<provider>`, `agentherd setup herder`.
- pi-ai 1.5.0: `getProviders()` (42 ids), `getModels(provider)`, `getEnvApiKey(provider, env)`,
  `completeSimple(model, context, {apiKey, signal})`.

## Scope

- `packages/core/src/models.ts`: `ModelService`, `ModelSettings`, `ModelRole` (`herder`,
  `reviewer`), `SecretStore`, `modelKeyAccount(id)` = `model:<id>`, `putService`,
  `removeService`, `chooseModel`, `modelFor`, `parseModelRef`/`formatModelRef`; roles pointing at
  removed models are cleared.
- `packages/herder/src/models.ts`: `builtinProviders()` (key-only pi-ai providers, chat models),
  `resolveModel(service, id)` (pi-ai model, unknown id of a known provider, OpenAI-compatible with
  128,000 / 8,192 limits), `serviceKey` (keychain, then provider variable), `testModel` (one
  request, 30 s), `herderFromSettings(settings, secrets)` → factory or reason.
- CLI: `config.json` `models`; `keychain` SecretStore; `agentherd model providers|list|add|
  add-compatible|key|use|test|remove`; `setup herder` and `packages/cli/src/herder.ts` removed;
  no default model.
- Out of scope (desktop plan): the settings page, OAuth logins, backup models, local endpoint
  detection, plain-words 401/402 errors, origin-change check.

## Commands

- `pnpm vitest run packages/core/test/models.test.ts packages/herder/test/models.test.ts packages/cli/test/models.test.ts`
- `pnpm check`

## Steps

1. Core model settings with unit tests. Verify: `pnpm vitest run packages/core/test/models.test.ts`.
2. Herder model resolution, key lookup and test with a local HTTP server. Verify:
   `pnpm vitest run packages/herder/test/models.test.ts`.
3. CLI `model` command, remove `setup herder`. Verify: `pnpm vitest run packages/cli` and `pnpm check`.
4. Manual run: `agentherd model add deepseek --models deepseek-flash` (key on stdin),
   `agentherd model use herder deepseek/deepseek-flash`, `agentherd model test deepseek/deepseek-flash`,
   then `agentherd start` and the plan 009 manual steps.

## Test plan

- Unit core: add/choose, refusals (unknown model, bad id/URL, no models, no provider), roles
  cleared, ref parsing.
- Unit herder: provider list, builtin and new model ids, OpenAI-compatible model, key order,
  test against a local server (key sent, error reported), Herder needs a model and a key.
- Unit CLI: key saved only in the keychain (not config.json), OpenAI-compatible without key,
  remove clears role and key, unknown provider/model refused.

## Done criteria

- All tests and `pnpm check` pass; no key appears in `config.json`.
- `agentherd start` without a chosen model prints `[herder] off: no model chosen for the Herder`.

## STOP conditions

- pi-ai's catalog API differs from "Current state".

## Maintenance notes

- 2026-11-04: written and implemented together after the owner chose the pi-desktop approach
  (configure a list first, choose later; third-party endpoints required).
