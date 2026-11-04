# ADR 0021: The owner keeps a list of model services, then chooses a model for each role

- Status: Accepted
- Date: 2026-11-04
- Related: [ADR 0020](0020-fork-pi-agent-loop-track-upstream.md), [00-baseline.md](../spec/00-baseline.md) item 9, [04-herder.md](../spec/04-herder.md), [02-architecture.md](../spec/02-architecture.md) (secrets), [plan 010](../../plans/010-model-list-and-roles.md)

## Context

Plan 009 gave the Herder a hard-coded default model (`deepseek/deepseek-flash`) and one key per
provider. That breaks the baseline ("models are chosen by the user during onboarding; no default
provider") and has no place for third-party endpoints (relays, company gateways, local Ollama).
The desktop app will have a settings page for models; the CLI needs the same data now.

Prior art, checked on 2026-11-04:

- **pi-desktop** (`packages/shared/src/types/providers.ts`; its ADRs 0012, 0020, 0114, 0156, 0307):
  the user configures a list of providers, each with model bindings; pi-ai built-in providers and
  OpenAI-compatible endpoints are both first class; user model ids, no allowlist; unknown custom
  models get a 128,000 context window and 8,192 max output tokens; secrets are write-only; the add
  dialog starts with choosing a service, then the key; presets follow pi-ai's built-in providers
  instead of a hand-kept list. Defaults per use are chosen from the configured list.
- **OpenBot** (`docs/architecture/providers.md`): key-only providers use Pi's model list; keys are
  encrypted with Electron `safeStorage`; 401/402 errors are explained in plain words; custom
  OpenAI-compatible endpoints and local Ollama / LM Studio detection; changing an endpoint's origin
  while keeping the old key is refused; backup models on failure.

## Decision

1. **A model list, then a choice per role.** `ModelSettings { services, roles }` in
   `packages/core/src/models.ts`. A service is either `builtin` (a pi-ai provider that needs only
   a key; its endpoint and model data come from pi-ai) or `openai-compatible` (base URL + model ids
   typed by the owner). Each service lists the models the owner turned on. Roles are `herder` and
   `reviewer`; each points at `service/model` from the list.
2. **No default.** No chosen Herder model → the Herder is off and only commands work.
3. **No secrets in the settings.** Keys are stored per service under the account
   `model:<serviceId>` in a `SecretStore` (the macOS keychain, held by the host process for both the
   CLI and the desktop app). For `builtin` services the provider's environment variable is a fallback. Keys are
   write-only: they can be replaced or removed, never shown.
4. **One code path for CLI and GUI.** Validation and editing (`putService`, `removeService`,
   `chooseModel`, `modelFor`) live in core; turning a choice into a pi-ai model, the provider
   catalog and a one-request connection test live in `packages/herder/src/models.ts` (the only
   place besides herder-loop that imports pi-ai, as ADR 0020 requires).
5. **The CLI `agentherd model ...` is a stopgap** until the desktop settings page (plan for the
   desktop app). The page follows pi-desktop: service cards, an add dialog that starts with the
   service, then the key, then models; a role card to choose models; a Test button.

## Consequences

- The config format changes: `herder {provider, model}` from plan 009 is dropped (never released).
- Removing a service or a model clears the roles that pointed at it.
- Not done yet: subscription logins (OAuth), backup models, local endpoint detection, plain-words
  errors for 401/402, refusing an origin change with a kept key. They go with the desktop page.

## Alternatives rejected

- **One provider + model in config with a default** (plan 009): breaks the baseline, no third-party
  endpoints.
- **Our own provider/model catalog:** goes stale; pi-ai already ships one and is updated with it.
- **Keys in config.json:** secrets must stay in the OS keychain (06-security).
