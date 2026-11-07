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
- **Local only.** No AgentHerd server. Secrets stay on your machine in `~/.agentherd/secrets.json`, readable only by you.

## Try it (M1)

M1 runs a scripted mock agent and sends its approval request to you in Feishu. Needs Node 22.18+
and pnpm.

```bash
pnpm install
node packages/cli/bin/agentherd.ts setup feishu   # scan the QR code with Feishu
node packages/cli/bin/agentherd.ts run --script packages/mock-agent/scripts/approve.yaml /tmp/demo "run the tests"
```

Tap **Allow** on the card. `node packages/cli/bin/agentherd.ts status` shows the decision.

With [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installed, run a real
agent. DSH runs in read-only sandbox mode, so each write asks you first:

```bash
node packages/cli/bin/agentherd.ts run --profile dsh /tmp/demo "Create out.txt containing hello"
```

[Pi](https://github.com/earendil-works/pi) works the same way. In the desktop app, open
**Agent** and press 下载: the app downloads the latest release and checks the publisher's hash.
You do not choose an agent: GPT models run in Codex, the rest in Pi, and DSH when you name it.
The Agent page shows them, with a 验证 button that starts an agent once to show whether it works. AgentHerd runs it behind a small ACP bridge that asks you
before every tool call except reads inside the folder. Pi uses its own login, or the model you
choose with `model use pi <service>/<model>`:

```bash
node packages/cli/bin/agentherd.ts run --profile pi /tmp/demo "Create out.txt containing hello"
```

To let the Herder answer plain messages, add a model service and choose the Herder's model
(the key is read from stdin and kept in `~/.agentherd/secrets.json`):

```bash
node packages/cli/bin/agentherd.ts model add deepseek --models deepseek-flash
node packages/cli/bin/agentherd.ts model use herder deepseek/deepseek-flash
node packages/cli/bin/agentherd.ts start
```

### Desktop app (M2, in development)

The app binds Feishu, adds model services and keys, chooses the Herder's model, and shows tasks
and open items. It starts the host itself, or connects to one started with `agentherd start`.

```bash
pnpm --filter @agentherd/desktop build
pnpm --filter @agentherd/desktop start
```

## Docs

- [Specs](docs/spec/00-baseline.md): what AgentHerd does
- [ADRs](docs/adr/README.md): why it is built this way
- [Plans](plans/README.md): how it is being built
- [References](docs/references.md): projects we learned from
- [AGENTS.md](AGENTS.md): rules for contributors and coding agents

## License

[MIT](LICENSE)

The Herder's context management uses [acp-kernel](https://github.com/ranxianglei/acp-kernel) from
[billion-context](https://github.com/ranxianglei/billion-context) (MIT plus an attribution term),
copied into [`packages/context-kernel`](packages/context-kernel/UPSTREAM.md).
