# ADR 0041: Agents get AgentHerd's tools and the owner's apps through a local MCP gateway

- Status: Accepted
- Date: 2026-11-07
- Changes: [03-agents §ACP mapping](../spec/03-agents.md), [04-herder §2](../spec/04-herder.md),
  [06-security](../spec/06-security.md); new [09-agent-tools](../spec/09-agent-tools.md)

## Context

The owner wants tasks to use their apps (Gmail, Slack, GitHub, calendar …) without registering
OAuth apps or passing a review. AgentHerd is open source and anyone may run it, so a shared
provider key cannot ship with it. The owner (2026-11-07) chose managed auth through
[Composio](https://composio.dev) with **each user bringing their own Composio API key**
("可以，用2吧").

Who uses the apps: the owner first considered the Herder calling them directly, then chose to
keep the Herder a dispatcher ("我觉得乙吧"): the Herder runs one serial queue on a light model, and
calls to outside services would make its turns slow and give it a write path that bypasses
approvals. Agents do the work, so agents get the apps.

Two ways to hand Composio to an agent were compared:

- Put Composio's hosted MCP URL and the `x-api-key` header into ACP `session/new`
  `mcpServers`. Least code, but the key reaches every agent process (and its logs), and whether a
  sending or deleting call is approved depends on each agent; AgentHerd cannot see the calls.
- A gateway in the host: agents get a local MCP server; the host adds the key and forwards. The
  owner chose this ("可以").

Until now `session/new` and `session/load` always send `mcpServers: []`; the `herd_report` tool of
ADR 0019 was never offered (Q14).

## Decision

- **One MCP server per task, run by AgentHerd.** Every `session/new` and `session/load` gets one
  stdio MCP server named `agentherd`: the bundled script `agentherd-mcp` run with the host's own
  Node. ACP requires every agent to support stdio MCP servers, so no capability check is needed.
  The script only relays MCP JSON-RPC between the agent and the host over a local socket (Unix
  socket mode 600 / Windows named pipe, as the host socket), with a per-task token. **No TCP
  listener**, so the trust boundary of 06-security §1 holds.
- **The gateway offers:**
  - `herd_report` (04-herder §2), always. This closes Q14.
  - The owner's apps through Composio, when a Composio key is set: the tools of the Composio
    session (search, schema, execute meta tools), proxied. Composio's connection management and
    remote workbench (code sandbox) meta tools are turned off: connecting is done in the app,
    code runs in the agent under AgentHerd's approvals.
- **The key stays in the host.** `secrets.json` key `composio`; `config.json` holds only
  `apps.composioUserId` (random, made once per machine). The token an agent gets works only for
  its own task and dies when the task ends.
- **App calls go through the approval pipeline.** The gateway makes an item of kind `permission`
  with tool call kind `app`, title "<App>: <tool name>", command = the tool slug, raw input = the
  arguments, and the tool's Composio hints. In the spirit of ADR 0029: a read-only tool is
  approved; a tool marked `destructiveHint` or with unknown hints asks the owner; any other write
  (create, update, send) is approved by AgentHerd and lands in the audit log and the task report.
  Asked whether sending an email should ask, the owner said no: "不用问，会话里说发邮件就行" —
  asking for it in the conversation is the approval.
  The owner's `deny` rules (tool kind `app`, command glob on the slug) still deny; `extraGuards`
  still ask; `observe` mode asks for every app write.
- **Connecting apps happens in the app**, not in a task: 设置 → 应用连接: paste the Composio key,
  see the apps, 连接 opens the browser for the provider's login, 断开 removes a connection.
- **The Herder does not call apps.** It sees which apps are connected (`session_list`) and adds
  them to a task's context when the owner's request needs one. Pi does not support MCP: a task
  that needs an app goes to an agent that does.
- No new runtime dependency for MCP: the gateway speaks the small subset of MCP it needs
  (`initialize`, `tools/list`, `tools/call`, `ping`, notifications) by hand; Composio is called
  over its REST API and hosted MCP endpoint with `fetch`.

## Consequences

- Tasks can read and act on the owner's apps; the owner connects each app once, with no OAuth app
  or review of their own. The consent screen shows Composio's name.
- Every app call is in the audit log; deleting asks the owner; sending an email does not by
  default (the owner can add a `deny` rule or an `extraGuards` entry).
- Composio's free tier limits calls per month; past it, app calls fail with Composio's error.
- Agents now always get an MCP server. An agent that fails on MCP servers would fail to start a
  session; the gateway can be turned off per profile (`mcp: false`).
- `herd_report` gives the board real stages instead of guesses from stop reasons.
