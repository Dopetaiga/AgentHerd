# ADR 0025: The Herder picks the model of each task from the owner's list

- Status: Accepted
- Date: 2026-11-05
- Related: [ADR 0021](0021-model-list-then-choose-per-role.md), [ADR 0024](0024-follow-latest-releases-six-agents.md), [04-herder.md](../spec/04-herder.md)

## Context

With six agents and a model list, the maintainer wants the Herder to choose the model of each
task ("我意思是，应该让主管自己挑模型"; "这个规则不急，先能挑选"). Answers to the follow-up
questions: the Herder may use **every model in the list**, **judges by itself** (no per-model
notes), and **does not ask first**: it tells the owner which agent and model it chose.

Agents take a model in different ways, and each only speaks some APIs.

## Decision

- `packages/herder/src/agent-models.ts` maps a model to the env of an agent:
  - **Pi**: any pi-ai model, through the bridge's model extension (`AGENTHERD_PI_MODEL`, `AGENTHERD_PI_KEY`).
  - **OpenCode**: OpenAI-compatible endpoints, as a custom provider `agentherd` in
    `OPENCODE_CONFIG_CONTENT`; the key in `AGENTHERD_OPENCODE_KEY`, referenced as `{env:…}`.
  - **Claude Code**: Anthropic-format endpoints (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`).
  - **Gemini CLI**: Google's Gemini API (`GEMINI_API_KEY`, `GEMINI_MODEL`).
  - **DSH, Codex**: their own settings only.
- The core gets `HerdOptions.agentModels` (`list()`, `envFor(profileId, ref)`) from the host;
  `startTask(…, model)` merges that env into the profile for this task only. `Task.model` is set
  and the task's agent reads "Pi · deepseek/deepseek-flash" on the board and in reports.
- The Herder sees the models and which agents can run each in `session_list`, and
  `session_start` takes an optional `model`. Without it the agent uses its own settings (and for
  Pi the model chosen for the `pi` role). The system prompt tells the Herder to follow a model
  the owner names, otherwise pick one that fits, and to say in one line which it chose.
- No selection rules yet (cheap vs strong); the Herder decides.

## Alternatives considered

- **Owner ticks the models the Herder may use.** Not chosen by the maintainer; may come back
  with cost limits.
- **Ask the owner before each start.** Rejected by the maintainer: one more tap per task.
- **ACP `session/set_model`.** Unstable in ACP and not offered by every agent; env works now.

## Consequences

- Verified 2026-11-05 with DeepSeek `deepseek-flash`: Pi and OpenCode 1.19.5 used the model,
  asked before writing and wrote the file. Claude Code and Gemini mappings are not run yet
  (their binaries are killed on this Mac or need sign-in).
- A model the agent cannot run is refused by the tool with the list of agents that can.
