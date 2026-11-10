<div align="center">

<img src="apps/desktop/resources/icon.svg" alt="AgentHerd" width="96">

# AgentHerd

English · [简体中文](README.zh-CN.md)

### Your coding agents, run from Feishu.<br>Tell the Herder what you want. It starts the agents on your Mac, follows them, and tells you what they did.

[![macOS](https://img.shields.io/badge/macOS-only-111?logo=apple)](docs/adr/0013-macos-only-for-v1.md) [![Feishu / Lark](https://img.shields.io/badge/chat-Feishu%20%2F%20Lark-3370ff)](docs/spec/05-channels.md) [![ACP](https://img.shields.io/badge/protocol-ACP-6b5bd6)](https://agentclientprotocol.com) [![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)<br>
[![agent: Pi](https://img.shields.io/badge/agent-Pi-444)](https://github.com/earendil-works/pi) [![agent: Codex](https://img.shields.io/badge/agent-Codex-444)](https://github.com/openai/codex) [![agent: DeepSeek Harness](https://img.shields.io/badge/agent-DeepSeek%20Harness-444)](https://github.com/deepseek-ai/deepseek-harness)

[Features](#features) · [How it works](#how-it-works) · [Get started](#get-started) · [Docs](#docs)

</div>

<br>

> **Status:** in active development. There is no release yet; run it from source.

## Features

- **Feishu is the remote control.** Send a message to start work. Answer questions, approve and
  continue from cards on your phone. One QR scan connects it. [Channels](docs/spec/05-channels.md)
- **A Herder that talks like a person.** The Herder is a light-model agent that takes your
  messages, starts and follows tasks, and tells you each result in its own words, with the
  agent's own reply one tap away. Pick how it talks: a capable friend, an opinionated partner,
  or a crisp secretary. [Herder](docs/spec/04-herder.md) · [ADR 0053](docs/adr/0053-the-herder-tells-task-results.md)
- **The right agent and model for each task.** Pi, Codex and DeepSeek Harness run through the
  [Agent Client Protocol](https://agentclientprotocol.com), on your own model services. The
  Herder picks the model, the agent follows from it, and a broken first turn switches to the
  next model. [Agents](docs/spec/03-agents.md) · [ADR 0031](docs/adr/0031-pick-the-agent-from-the-model.md)
- **Tasks that keep going.** Each task works on a hidden copy of your project, is kept after it
  ends, and can be continued later. The app shows every task's conversation.
  [ADR 0043](docs/adr/0043-tasks-work-on-hidden-copies.md) · [ADR 0039](docs/adr/0039-tasks-kept-and-continued.md)
- **It only asks when it must.** Ordinary tool calls go through. A mass delete asks you first.
  A watchdog notices a stuck task, and urgent news reaches you before small news.
  [ADR 0029](docs/adr/0029-only-mass-deletes-ask-the-owner.md) · [ADR 0046](docs/adr/0046-tell-the-owner-at-the-right-time.md)
- **Watches the work around your code.** It follows the pull requests its tasks open, offers new
  GitHub issues and reviews as "start a task / ignore", and watches mail when you ask it to.
  [ADR 0047](docs/adr/0047-follow-the-pull-requests-tasks-open.md) · [ADR 0052](docs/adr/0052-offer-new-github-work-when-asked.md) · [ADR 0048](docs/adr/0048-watch-mail-only-when-asked.md)
- **Schedules in plain words.** "Every weekday at 9, check for new issues" — the Herder makes the
  schedule, and missed runs happen once when your Mac wakes. [ADR 0055](docs/adr/0055-schedules-the-herder-makes.md)
- **Memory that stays useful.** The whole conversation is kept, and the Herder folds old parts
  itself. It learns a lesson only when a task went wrong, and finds past results in task records.
  [ADR 0045](docs/adr/0045-herder-context-folded-by-the-model.md) · [ADR 0054](docs/adr/0054-say-what-matters.md)
- **Local only.** No AgentHerd server. Keys stay in `~/.agentherd/secrets.json`, readable only by
  you. Agents can keep running with the lid closed. [Security](docs/spec/06-security.md) · [ADR 0011](docs/adr/0011-keep-running-with-lid-closed.md)

## How it works

```mermaid
flowchart LR
  you["You, in Feishu"] <--> herder["Herder<br/>(light model)"]
  herder --> host["AgentHerd on your Mac"]
  host -- ACP --> pi["Pi"]
  host -- ACP --> codex["Codex"]
  host -- ACP --> dsh["DeepSeek Harness"]
  host --> watch["GitHub · mail · schedules"]
```

AgentHerd is an Electron app with a headless core. The core starts each agent over ACP, checks
every tool call against its rules, and keeps tasks, memory and the Herder's conversation in one
local SQLite file (`~/.agentherd/herd.db`). The Herder is the only one that talks to you; your
own words reach the agent unchanged.
[Architecture](docs/spec/02-architecture.md) · [Herder interaction](docs/spec/08-herder-interaction.md)

## Get started

Needs macOS, Node 22.18+, pnpm and a Feishu (or Lark) account.

```bash
pnpm install
pnpm --filter @agentherd/desktop start
```

The first run walks you through it: scan a QR code to connect Feishu, add a model service and
its key, pick the Herder's model and how it talks. On the **Agent** page, download Pi or Codex
and press 验证 to check that it starts. Then send the Herder a message in Feishu.

<details>
<summary>Command line, without the app</summary>

```bash
node packages/cli/bin/agentherd.ts setup feishu                          # scan the QR code with Feishu
node packages/cli/bin/agentherd.ts model add deepseek --models deepseek-flash   # the key is read from stdin
node packages/cli/bin/agentherd.ts model use herder deepseek/deepseek-flash
node packages/cli/bin/agentherd.ts start
```

Run one task directly with `run --profile pi /tmp/demo "Create out.txt containing hello"`, and see
recent decisions with `status`.

</details>

## Docs

[Baseline](docs/spec/00-baseline.md) · [Product](docs/spec/01-product.md) · [Architecture](docs/spec/02-architecture.md) · [Agents](docs/spec/03-agents.md) · [Herder](docs/spec/04-herder.md) · [Channels](docs/spec/05-channels.md) · [Security](docs/spec/06-security.md) · [ADRs](docs/adr/README.md) · [Plans](plans/README.md) · [References](docs/references.md) · [AGENTS.md](AGENTS.md)

## License

AgentHerd is under the [MIT License](LICENSE).

<sub>The Herder's loop is a fork of [Pi](https://github.com/earendil-works/pi)'s agent loop (MIT, [`packages/herder-loop`](packages/herder-loop/UPSTREAM.md)). Its context management uses [acp-kernel](https://github.com/ranxianglei/acp-kernel) from [billion-context](https://github.com/ranxianglei/billion-context) (MIT plus an attribution term), copied into [`packages/context-kernel`](packages/context-kernel/UPSTREAM.md). See [References](docs/references.md).</sub>
