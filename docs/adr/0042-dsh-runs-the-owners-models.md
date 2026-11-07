# ADR 0042: DSH runs the owner's models through a patch overlay

- Status: Accepted
- Date: 2026-11-07

## Context

ADR 0025 and ADR 0031 left DSH on its own settings. `dsh acp` boots the `acp` profile under
`~/.dsh/profiles/acp`, and its ACP route defaults to `deepseek-official / deepseek-v4-flash`. The
providers the owner set up for the DSH desktop app are in another profile (`desktop`), so a DSH
task failed with `Insufficient Balance` even though the owner had working models both in DSH and
in AgentHerd. The owner (2026-11-07): "这里acp我觉得要可以调用在agentherd里配置的模型".

The DSH launcher takes `--patch <file>`, an extra patch-list overlay applied after the profile's
own layer. Its `llm-pi-ai` providers speak `openai-completions`, `openai-responses` and
`anthropic-messages`, and read the key from the variable named in `apiKeyEnv`; process env wins
over `~/.dsh/.env`.

## Decision

- When a task runs DSH with a model from the owner's list, the host writes an overlay with one
  provider `agentherd` (that model's API, base URL, headers and limits) and points the `acp`
  route at it: `[{id: llm-pi-ai, config.providers.agentherd}, {id: acp, config: {provider, model}}]`.
  The overlay replaces the profile's providers for that process only.
- The overlay holds no key. The key goes in `AGENTHERD_DSH_KEY`, named by `apiKeyEnv`.
- The file is `<home>/run/dsh-model-<sha256 of content, 16 hex>.json` (mode 600), written once and
  reused. The task's command gets `--patch <file>` appended.
- `AgentModels.envFor` becomes `launchFor(profileId, ref) → {env, args?}` so an agent can take a
  model through arguments as well as env.
- DSH lists the models whose API is one of the three above. Without a model, DSH still uses its
  own settings, and it still runs only when the owner names it (ADR 0031).

## Consequences

- DSH tasks work with the same models as Pi and Codex, without the owner editing DSH's profile.
- The patch format and the `acp` and `llm-pi-ai` ids belong to DSH; a DSH release that renames
  them breaks this until the overlay is updated. Verified with DSH 0.2.1-rc.2.
- Models on Google's own API do not run in DSH.
