# Glossary

Use these terms in code, UI text, docs and commit messages. Read this page before you name a
new type, table, IPC channel or product string.

| Term | Meaning | Do not use |
| --- | --- | --- |
| **AgentHerd** | The product | Herd (alone), the bot |
| **Herder** | The decision pipeline inside AgentHerd | supervisor, manager, brain |
| **Agent** | A coding agent product (Claude Code, Codex, an ACP agent) | bot, worker |
| **Session** | One conversation of one agent, identified by the agent's own session id | thread, chat |
| **ACP** | Agent Client Protocol; the only runtime protocol between AgentHerd and agents | |
| **Agent profile** | Config that says how to start one ACP agent (command, env) | adapter, driver |
| **Exporter** | Code that writes AgentHerd rules into one agent's own permission config | adapter, sync |
| **Export status** | Per rule and agent: `exact`, `narrowed` or `not exported` | |
| **Item** | An event that needs the owner, or a notification for the owner, in the inbox | ticket, task, request |
| **Inbox** | The queue of open items | |
| **Decision** | The result for one item: allow, deny, answer, continue, escalate | verdict |
| **Escalate** | Send the item to the owner | |
| **Rule** | A deterministic match + action (L0) | policy |
| **Guard list** | Built-in matches that always escalate | blocklist |
| **Precedent** | A past decision used to decide a new item | |
| **Mode** | How much AgentHerd applies by itself: `observe`, `assist`, `auto` | level |
| **Channel** | A chat app integration (Feishu first) | IM, notifier |
| **Owner** | The one person allowed to act on items | admin, user (in code) |
| **Card** | A channel message for one item | |
| **Task** | Work the owner starts from a channel with `run` | job |
