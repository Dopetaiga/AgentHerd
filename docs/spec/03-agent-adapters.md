# 03. Agent adapters

Applied ADR: [0006](../adr/0006-agent-adapters-attach-and-launch.md).

AgentHerd supervises every supported agent through one adapter model. An adapter hides how
an agent reports state and how it accepts answers.

Statements marked **(verify)** come from documentation or memory and are not yet checked
against the current agent version. Each one has a row in [open-questions.md](open-questions.md).
Check them before the plan that depends on them runs.

## 1. Two integration modes

| Mode | Who starts the agent | How AgentHerd connects | Control |
| --- | --- | --- | --- |
| **Attach** | The user, in a terminal or IDE, as usual | Hooks and session files of the agent | Only what the agent's hooks allow |
| **Launch** | AgentHerd, for example for a task sent from Feishu | A programmatic protocol: Codex app-server, ACP, an SDK | Full: approvals, questions, follow-ups, interrupt |

Attach mode matters most for adoption: users keep their tools and habits. Launch mode is
needed for tasks that start from the chat app.

## 2. Capabilities

Each adapter declares which capabilities it supports, per mode. The Herder and the UI read
the capability set and never assume a capability that is not declared.

| Capability | Meaning |
| --- | --- |
| `observe` | Report session start/end, state changes and the last message |
| `approve` | Answer a permission prompt with allow or deny |
| `answer` | Answer a question the agent asked |
| `continue` | Make a stopped agent continue with an instruction (a nudge) |
| `steer` | Send an instruction to a working agent without stopping it |
| `interrupt` | Stop the current turn |
| `launch` | Start a new session with a prompt and a working directory |

## 3. Normalized events

```ts
type AgentKind = "claude-code" | "codex" | "acp" | "mock";

interface AgentEvent {
  v: 1;
  id: string;                // ULID, assigned by the core
  at: string;                // ISO 8601
  agent: AgentKind;
  agentName?: string;        // for ACP: "opencode", "gemini", ...
  sessionId: string;         // the agent's own session id
  cwd: string;
  type:
    | "session.started" | "session.ended"
    | "turn.started" | "turn.stopped"
    | "approval.requested" | "question.asked"
    | "notification" | "error";
  payload: unknown;          // typed per event type in packages/protocol
  raw?: unknown;             // the original hook or protocol message, for debugging only
}
```

`approval.requested` and `question.asked` need a decision. `turn.stopped` may need one (the
Herder can decide to continue). All other events only update state.

Derived session states: `working`, `waiting-approval`, `waiting-answer`, `idle`, `looping`,
`error`, `ended`. `looping` is set by the registry, not by an adapter (see
[04-herder.md](04-herder.md#6-loop-detection)).

## 4. Claude Code

Attach mode, through hooks in `~/.claude/settings.json`. The desktop app installs and removes
them; it never edits other hook entries.

| Hook | Event | Notes |
| --- | --- | --- |
| `SessionStart`, `SessionEnd` | `session.started`, `session.ended` | |
| `UserPromptSubmit` | `turn.started` | |
| `PermissionRequest` | `approval.requested` | The hook output can allow or deny **(verify output shape)** |
| `Notification` | `notification` | For example "waiting for your input" |
| `Stop` | `turn.stopped` | Output `{"decision":"block","reason":...}` makes Claude continue **(verify)** |
| `PreToolUse` with tool `AskUserQuestion` | `question.asked` | Whether a hook can answer the question is unknown **(verify)** |

Capabilities in attach mode: `observe`, `approve`, `continue`; `answer` depends on the item
above. `steer` and `interrupt`: not available.

Launch mode: through the Claude Agent SDK or `claude -p --output-format stream-json`
**(verify which one fits)**. Not in M1.

## 5. Codex

- Launch mode: `codex app-server` (JSON-RPC over stdio). Approvals for commands and file
  changes arrive as server requests that the client answers **(verify method names)**.
  Capabilities: all.
- Attach mode: Codex session files under `~/.codex/sessions/` give `observe`. Whether Codex
  hooks or `notify` can give `approve` for a TUI session is open **(verify)**.

## 6. ACP agents

First real agent (ADR 0014). Tested with DeepSeek Harness: `dsh acp` speaks ACP over stdio
and answered `initialize` on 2026-11-04 (protocol version 1, session `close`/`list`/`resume`).

AgentHerd acts as an ACP client and starts the agent (launch mode only). The agent sends
`session/request_permission` and the client answers with one of the offered options.
Capabilities: all except attach. One adapter serves every ACP agent; the agent command line
is configuration.

## 7. Mock agent

`adapter-mock` runs a scripted fake agent. A script is a list of steps:

```yaml
- emit: approval.requested
  payload: { tool: Bash, command: "pnpm test" }
  expect: allow            # the test fails if the decision differs
- emit: turn.stopped
  payload: { lastMessage: "Done. All tests pass." }
```

It supports every capability. It is the main tool for development and E2E tests, because
real agents are not always available on the development machine (see
[07-delivery.md](07-delivery.md#3-testing)).

## 8. Adapter interface

```ts
interface AgentAdapter {
  kind: AgentKind;
  capabilities(mode: "attach" | "launch"): Capability[];
  install?(): Promise<InstallReport>;   // attach mode: write hooks; must be idempotent
  uninstall?(): Promise<void>;          // remove only what install() wrote
  start(ctx: AdapterContext): Promise<void>;
  apply(sessionId: string, decision: Decision): Promise<ApplyResult>;
  launch?(req: LaunchRequest): Promise<{ sessionId: string }>;
}
```

`install()` must keep a backup of every file it changes and must be safe to run twice.
