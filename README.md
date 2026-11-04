# AgentHerd

> Herd your coding agents. Only get pinged when it matters.

English | [简体中文](README.zh-CN.md)

You run several coding agents at once — Claude Code, Codex, OpenCode, Gemini CLI. They keep
stopping to ask for permission, to ask a question, or because they are done or stuck.
AgentHerd watches them from your desktop. It handles the routine prompts that have a clear
precedent, and it pings you in your chat app, one item at a time, only when a decision
really needs you.

> **Status:** design phase. There is no runnable code yet. Read the
> [baseline spec](docs/spec/00-baseline.md).

## How it works

- **Chat app as the remote control.** Approve, deny or answer from a card on your phone.
  Start new tasks with a message. Feishu (Lark) is the first channel; one QR scan sets it up.
- **Any agent that speaks ACP.** AgentHerd starts agents through the
  [Agent Client Protocol](https://agentclientprotocol.com): Claude Code, Codex, Gemini CLI,
  OpenCode, DeepSeek Harness and more. Adding one is a line of config.
- **One rule set, everywhere.** Your rules also compile into each agent's own permission
  config, so sessions you start in a terminal follow them too.
- **A secretary for your agents.** The Herder, a light-model
  [Pi](https://github.com/earendil-works/pi) agent, takes your messages, starts tasks, puts you
  through to any task, keeps a pinned task board and tells you what each agent did when it
  finishes. Your words reach the agent unchanged.
- **Approvals in tiers.** Guard list → your rules → a Reviewer on your strongest model → you.
  When unsure or broken, it asks you. It never guesses "allow". The Herder cannot approve.
- **Trust in steps.** It starts in `observe` mode: it only suggests and measures how often it
  agrees with you. You turn on `assist` and `auto` when the numbers say so.
- **Local only.** No AgentHerd server. Secrets stay in your OS keychain.

## Docs

- [Specs](docs/spec/00-baseline.md): what AgentHerd does
- [ADRs](docs/adr/README.md): why it is built this way
- [Plans](plans/README.md): how it is being built
- [References](docs/references.md): projects we learned from
- [AGENTS.md](AGENTS.md): rules for contributors and coding agents

## License

[MIT](LICENSE)
