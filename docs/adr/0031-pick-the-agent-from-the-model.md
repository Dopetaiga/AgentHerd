# ADR 0031: Pick the agent from the model: Codex for GPT models, Pi for the rest

- Status: Accepted
- Date: 2026-11-05
- Supersedes: the six-agent list of [ADR 0024](0024-follow-latest-releases-six-agents.md)

## Context

The owner had to know six agents (DSH, Pi, OpenCode, Gemini CLI, Claude Code, Codex) and the
Herder had to pick one per task. On the maintainer's Mac only DSH, Pi and OpenCode run; Claude
Code and Codex are killed by endpoint security and Gemini CLI needs its own sign-in. Most owners
configure DeepSeek-style keys, which only Pi (and OpenCode) can use with AgentHerd's model
injection. The maintainer said: "我们就不要让用户选agent了，如果有gpt系列，自动匹配codex", and
chose: only GPT models go to Codex, everything else to Pi; drop OpenCode, keep DSH; when Codex
cannot run, move the task to Pi with the same model and tell the owner.

Codex's embeddable harness (`codex app-server`, used by the Codex SDK and by
`@agentclientprotocol/codex-acp`) speaks only the Responses API: Codex 0.166 rejects
`wire_api = "chat"`. codex-acp reads `CODEX_CONFIG` (JSON merged into the session config) and
`MODEL_PROVIDER`, so AgentHerd can give it a custom provider without a ChatGPT login.

## Decision

- The catalog has three agents: Pi, Codex (codex-acp from npm) and DSH. OpenCode, Gemini CLI and
  Claude Code are removed.
- The owner never picks an agent. `session_start` takes a model; `profile` is optional and only
  set when the owner names an agent (in practice `dsh`). Without it, `agentForModel`
  (`packages/herder/src/agent-models.ts`) gives GPT models (`isGptModel`: `gpt-*`, `chatgpt*`,
  `codex*`, `o1`…`o9`) to Codex when it is installed, everything else (and a task with no model)
  to Pi.
- Codex gets the model through env: `CODEX_CONFIG` with provider `agentherd` (`base_url`,
  `env_key: AGENTHERD_CODEX_KEY`, `wire_api: "responses"`), `MODEL_PROVIDER=agentherd`, the key in
  `AGENTHERD_CODEX_KEY`, and `NO_BROWSER=1`.
- When the Codex agent does not start, or its first turn breaks before any text or tool call
  (endpoint without the Responses API, binary killed), AgentHerd restarts the task in Pi with the
  same model and tells the owner (`AgentModels.next` now returns an agent and a model; ADR 0030's
  switch also runs when the agent fails to start).
- The host downloads what the model list needs (`autoInstallAgents`, on in the app): Pi always,
  Codex when a GPT model is listed.
- DSH stays: it runs with its own settings and only when the owner names it.

## Consequences

- One less decision for the owner and the Herder; the Agent page only shows status and downloads.
- GPT models behind Chat-Completions-only gateways pay one failed Codex start before Pi takes over.
- Codex runs are unverified on the maintainer's Mac (the binary is killed); they need a check on
  another machine.
