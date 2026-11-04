# 03. Agents: ACP runtime and rule export

Applied ADRs: [0015](../adr/0015-acp-is-the-only-runtime-protocol.md),
[0016](../adr/0016-one-rule-source-exported-to-agents.md), [0014](../adr/0014-acp-first-real-agent.md).

AgentHerd reaches agents in two ways, from one rule set:

| Path | Sessions | Who decides | When no rule matches |
| --- | --- | --- | --- |
| **ACP runtime** | Sessions AgentHerd starts | The Herder, at run time | The item goes to the owner in the channel |
| **Rule export** | Sessions the user starts in a terminal or IDE | The agent, from its own config written by AgentHerd | The agent asks in its own UI |

Statements marked **(verify)** are not yet checked against the current agent version. Each
one has a row in [open-questions.md](open-questions.md).

## 1. ACP runtime

AgentHerd is an [Agent Client Protocol](https://agentclientprotocol.com) client
(`@agentclientprotocol/sdk`). It starts the agent as a child process and talks JSON-RPC over
stdio. There is no agent-specific runtime code in the core.

### Agent profiles

An agent is a profile in configuration, not a package:

```json
{
  "id": "dsh",
  "name": "DeepSeek Harness",
  "command": ["dsh", "acp"],
  "env": { "DSH_PERMISSION_MODE": "read-only" },
  "exporter": null
}
```

| Agent | Command | Status |
| --- | --- | --- |
| DeepSeek Harness | `dsh acp` | Tested 2026-11-04: `initialize` returns `deepseek-harness-acp`, session `close`/`list`/`resume`. Asks over `session/request_permission` only when a command needs more than its sandbox mode allows; see [DSH approvals](#dsh-approvals) |
| Claude Code | `claude-agent-acp` (npm `@agentclientprotocol/claude-agent-acp`, 0.100.0) | Package exists; not run **(verify, Q01)** |
| Codex | `codex-acp` (npm `@zed-industries/codex-acp`, 0.16.0) | Package exists; not run **(verify, Q01)** |
| Gemini CLI, OpenCode, Qwen Code, others | Their ACP mode | **(verify, Q02)** |

The desktop app ships built-in profiles for these and lets the user add any ACP command.

### Mapping ACP to AgentHerd

| ACP | AgentHerd |
| --- | --- |
| `initialize` → `agentCapabilities` | Stored per profile; the UI hides actions the agent does not support |
| `session/new` (with `cwd`, `mcpServers`), `session/prompt` | Start a task (the Herder's `session_start`). `mcpServers` carries AgentHerd's `herd_report` tool where the agent supports MCP **(verify, Q14)** |
| `session/update` notifications (message chunks, tool calls, plan) | Session state, progress messages, loop detection |
| `session/request_permission` (tool call + options) | An item that needs a decision ([04-herder.md](04-herder.md)) |
| Answer with the selected `optionId`, or `cancelled` | Apply the decision. `allow` / `deny` map to the agent's `allow_once` / `reject_once` options; "Always do this" creates an AgentHerd rule, never the agent's `allow_always` |
| End of `session/prompt` with a stop reason | `turn.stopped`; without a `herd_report`, the last message is the fallback report |
| `session/cancel` | Interrupt |
| Follow-up `session/prompt` | A relayed owner message, or a Herder prompt |
| `session/load` / `resume` (if supported) | Reopen after an AgentHerd restart |

Permission requests may carry a partial tool call: ACP sends a tool call once and later only
changed fields, and DSH's `request_permission` carries only the `toolCallId`. The ACP client
merges updates per `toolCallId` (`ToolCallTracker`), so an item always shows the command and
input the agent announced earlier.

### DSH approvals

Tested 2026-11-04 with DSH 0.0.1 ACP (`/Applications/DeepSeek Harness.app/.../runtime/cli/bin/dsh acp`):

- DSH runs commands in its sandbox and asks only for escalations. With the default mode, a
  write inside `cwd` (`echo hello > out.txt`) ran without a permission request.
- With `DSH_PERMISSION_MODE=read-only` in the profile `env`, the write was denied by the
  sandbox, the model retried with `sandbox_permissions: workspace-write` and a
  `justification`, and DSH sent `session/request_permission` with options `allow-once`
  (`allow_once`) and `reject-once` (`reject_once`). After `allow-once`, the file was written.
- Other modes: `workspace-write`, `danger-full-access`. The built-in DSH profile uses
  `read-only` so every write and network command reaches the AgentHerd pipeline; the rules and
  the owner decide, not DSH's own default.
- `rawInput` of the escalated call has `command`, `description` and `justification`; the card
  shows the justification.
- DSH writes two harmless stderr lines: `Node.js environment variables are disabled because
  this process is invoked by other apps.` and `Got response to unknown request null`.

How each agent asks the user a question over ACP (permission request, or a message that ends
the turn) is open **(verify, Q03)**.

### Session states

`starting`, `working`, `waiting-approval`, `idle` (turn ended), `looping`, `error`, `ended`.
`looping` is set by the watchdog ([04-herder.md](04-herder.md#watchdog)).

### Restarts

Agent processes are children of the core. If the core stops, its agent sessions stop. On the
next start, sessions whose agent supports `session/load` or `resume` can be reopened; the
others are marked `ended`.

## 2. Rule export

The rule set in AgentHerd is the only source ([ADR 0016](../adr/0016-one-rule-source-exported-to-agents.md)).
An **exporter** per agent translates it into that agent's own permission config, so that
sessions the user starts outside AgentHerd follow the same rules, even when AgentHerd is not
running.

### What is exported

- Rules with action `allow` or `deny`.
- The guard list, as `deny` (or `ask`, if the agent cannot deny that case).
- Nothing else. Model decisions, precedents and channel escalation exist only on the ACP path.

### Export rules

1. **Never widen.** If the agent cannot express a rule exactly (for example "only inside the
   project directory"), export a narrower form or do not export it. The desktop app marks
   each rule per agent: `exact`, `narrowed` or `not exported`, with the reason.
2. **Own only what you wrote.** AgentHerd writes its entries in a separate file or a marked
   block, keeps a backup of every file it changes, and `remove` deletes only its own entries.
3. **One direction.** AgentHerd does not import changes made by hand in the agent's config.
   It detects them (hash of its own block) and shows a warning.
4. **Explicit action.** Export runs when the user turns it on for an agent, and after rule
   changes while it is on.

### Targets

| Agent | Target config | Notes |
| --- | --- | --- |
| Claude Code | `permissions.allow` / `deny` / `ask` in `~/.claude/settings.json` or project `.claude/settings.json`, entries like `Bash(pnpm test:*)` | **(verify format, Q04)** |
| Codex | Approval policy, sandbox mode, command rules (execpolicy) | Coarser than AgentHerd rules; expect `narrowed` **(verify, Q05)** |
| Gemini CLI | Allowed / excluded tools, policy files | **(verify, Q06)** |
| OpenCode | `permission` in `opencode.json`, glob patterns | **(verify, Q06)** |

### Exporter interface

```ts
interface RuleExporter {
  agent: string;                                    // profile id
  detect(): Promise<{ installed: boolean; configPaths: string[] }>;
  plan(rules: Rule[]): ExportPlan;                  // pure: per rule exact | narrowed | skipped + reason
  apply(plan: ExportPlan): Promise<ExportReport>;   // backup, then write own block
  remove(): Promise<void>;                          // delete own block only
  drift(): Promise<DriftReport>;                    // own block changed by hand?
}
```

`plan()` is pure and has unit tests with a case for every rule shape.

## 3. Mock agent

`packages/mock-agent` is a scripted fake **ACP agent** (a real ACP server over stdio). A script
is a list of steps:

```yaml
- request_permission:
    toolCall: { kind: execute, title: "pnpm test" }
    options: [allow_once, reject_once]
  expect: allow_once        # the test fails if the decision differs
- end_turn: { message: "Done. All tests pass." }
```

Because it speaks real ACP, E2E tests run the same client code as real agents. It is the main
tool for development, because Claude Code and Codex cannot run on the development machine
([07-delivery.md](07-delivery.md#3-testing)).

## 4. Later directions (not in v1)

- **Hook plugin for terminal sessions:** observe and approve Claude Code sessions started in a
  terminal through its hooks, for users who need channel escalation there.
- **ACP proxy:** AgentHerd also acts as an ACP agent, so an ACP editor (for example Zed)
  connects to AgentHerd, which forwards to the real agent and supervises in between.
