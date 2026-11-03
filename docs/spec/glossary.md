# Glossary

Use these terms in code, UI text, docs and commit messages. Read this page before you name a
new type, table, IPC channel or product string.

| Term | Meaning | Do not use |
| --- | --- | --- |
| **AgentHerd** | The product | Herd (alone), the bot |
| **Herder** | The decision pipeline inside AgentHerd | supervisor, manager, brain |
| **Agent** | A coding agent product (Claude Code, Codex, an ACP agent) | bot, worker |
| **Session** | One conversation of one agent, identified by the agent's own session id | thread, chat |
| **Adapter** | The package that connects one agent kind to the core | driver, plugin, runtime |
| **Attach mode** | AgentHerd joins a session the user started | |
| **Launch mode** | AgentHerd starts the session | spawn mode |
| **Event** | A normalized `AgentEvent` | message, signal |
| **Item** | An event that needs the owner, or a notification for the owner, in the inbox | ticket, task, request |
| **Inbox** | The queue of open items | |
| **Decision** | The result for one item: allow, deny, answer, continue, escalate, defer | verdict |
| **Defer** | Let the agent ask the user in its own UI | skip, pass |
| **Escalate** | Send the item to the owner | |
| **Rule** | A deterministic match + action (L0) | policy |
| **Guard list** | Built-in matches that always escalate | blocklist |
| **Precedent** | A past decision used to decide a new item | |
| **Mode** | How much AgentHerd applies by itself: `observe`, `assist`, `auto` | level |
| **Presence** | Where human decisions go: `desk` or `away` | status |
| **Channel** | A chat app integration (Feishu first) | IM, notifier |
| **Owner** | The one person allowed to act on items | admin, user (in code) |
| **Card** | A channel message for one item | |
| **Task** | Work the owner starts from a channel with `run` | job |
