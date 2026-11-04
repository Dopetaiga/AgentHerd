# Plan 002: The ACP client runs a scripted mock agent and answers its permission requests

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat <plan 001 done sha>..HEAD -- packages/protocol docs/spec/03-agents.md`.
> If files changed in a way that makes "Current state" wrong, STOP.

## Status

- Milestone: M1
- Size: M
- Risk: MEDIUM (first use of `@agentclientprotocol/sdk` 2.x)
- Depends on: plan 001
- Planned at: `c9f52e2`, 2026-11-04

## Why this matters

ACP is the only runtime protocol ([ADR 0015](../docs/adr/0015-acp-is-the-only-runtime-protocol.md)).
The mock agent is a real ACP server, so every E2E test exercises the same client code that
real agents use ([03-agents.md §3](../docs/spec/03-agents.md#3-mock-agent)). Claude Code and
Codex cannot run on the development machine, so this pair is the main development tool.

## Current state

- `packages/protocol` and `packages/rules` exist (plan 001).
- SDK facts checked on 2026-11-04 with `@agentclientprotocol/sdk` 2.4.0 (Apache-2.0):
  - Default import `@agentclientprotocol/sdk` is stable ACP v1. Use only this entrypoint.
  - Agent side: `agent({ name })`, register handlers with
    `onRequest(methods.agent.initialize, handler)` etc., then `connect(stream)`.
  - Client side: `client({ name })`, register `onRequest(...)` / `onNotification(...)`, then
    `connectWith(stream, async (ctx) => …)`; call the agent with
    `ctx.request(methods.agent.session.new, params)`.
  - `ndJsonStream(output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>)`
    builds the stdio stream. Types: `dist/v1/stable/acp.d.ts` in the package.
  - The README names these functions; read the `.d.ts` for exact names of the method
    constants before writing code.
- `dsh acp` exists at `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`
  and answers `initialize` (agentInfo `deepseek-harness-acp`). It is not used in this plan.

## Scope

**In scope:**

- `packages/mock-agent`: ACP agent over stdio driven by a YAML script; a `bin` entry.
- `packages/acp-client`: start an agent from an `AgentProfile`, `initialize`, `session/new`,
  `session/prompt`, `session/cancel`; map `session/update` and `session/request_permission`
  to AgentHerd events; answer permission requests from a decision.

**Out of scope:**

- `session/load` / resume, authentication, terminals, file system client capabilities
  (advertise `fs: false`, `terminal: false`).
- Any decision logic. The client exposes requests; the caller decides.

## Commands you will need

```bash
pnpm add --filter @agentherd/acp-client @agentclientprotocol/sdk@2.4.0
pnpm add --filter @agentherd/mock-agent @agentclientprotocol/sdk@2.4.0 yaml
pnpm --filter @agentherd/acp-client test
```

## Steps

### Step 1: Mock agent script format

`packages/mock-agent/src/script.ts`: parse and validate a YAML script (the `yaml` package).
Steps, from [03-agents.md §3](../docs/spec/03-agents.md#3-mock-agent), extended minimally:

```yaml
- message: "Running the tests"            # agent_message_chunk update
- tool_call: { kind: read, title: "read package.json" }   # tool_call update, no permission
- request_permission:
    toolCall: { kind: execute, title: "pnpm test", rawInput: { command: "pnpm test" } }
    options: [allow_once, reject_once]
  expect: allow_once                      # optional; mismatch → the agent ends the turn with stop reason "refusal" and writes "EXPECT FAILED" to stderr
  on_reject: end_turn                     # optional; default continue
- end_turn: { message: "Done. All tests pass." }
```

A script runs once per `session/prompt`. An invalid script fails at start with a clear
message and exit code 2.

Unit test: parse valid and invalid scripts.

**Verify:** `pnpm --filter @agentherd/mock-agent test` → passes.

### Step 2: Mock agent ACP server

`packages/mock-agent/src/agent.ts` and `bin/mock-agent.ts` (run with `tsx`): an ACP agent on
stdin/stdout using `ndJsonStream`.

- `initialize` → protocol version from the SDK, `agentInfo { name: "agentherd-mock-agent" }`,
  no auth methods.
- `session/new` → a new session id; store `cwd`.
- `session/prompt` → play the script: send updates, call `session/request_permission` on the
  client and wait, then return the stop reason (`end_turn`, or `cancelled` after
  `session/cancel`).
- Script path from `--script <path>` or env `MOCK_AGENT_SCRIPT`.
- Logs go to stderr only. stdout carries only ACP.

**Verify:** a test spawns the bin, sends `initialize` and `session/new` through the SDK
client, and gets a session id.

### Step 3: ACP client — process and connection

`packages/acp-client/src/process.ts`: `startAgent(profile: AgentProfile, opts: { cwd; env? }): AgentConnection`.

- `spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...profile.env } })`.
- Wrap stdio into web streams (`Readable.toWeb`, `Writable.toWeb`) for `ndJsonStream`.
- Capture stderr into a ring buffer (last 200 lines), passed through `redact` from
  `@agentherd/rules` before it is stored or logged.
- `initialize` with client capabilities `fs: false`, `terminal: false`; keep the returned
  `agentCapabilities` and `agentInfo`.
- On process exit or stream error: every pending permission request resolves as
  `cancelled`, and the connection emits `exit` with code and the stderr tail.

### Step 4: ACP client — sessions and events

`packages/acp-client/src/session.ts`. Public surface (no ACP types cross it):

```ts
interface AgentConnection {
  readonly profile: AgentProfile;
  readonly agentName: string;
  newSession(cwd: string): Promise<string>;                     // session id
  prompt(sessionId: string, text: string): Promise<{ stopReason: string }>;
  cancel(sessionId: string): Promise<void>;
  on(event: "update", fn: (e: SessionUpdateEvent) => void): void;
  on(event: "permission", fn: (r: PermissionRequest) => void): void;
  on(event: "exit", fn: (e: { code: number | null; stderrTail: string[] }) => void): void;
  close(): Promise<void>;
}

interface PermissionRequest {
  sessionId: string;
  requestId: string;          // AgentHerd id, unique per connection
  toolCall: ToolCallInfo;     // from @agentherd/protocol
  options: { id: string; kind: "allow_once" | "allow_always" | "reject_once" | "reject_always"; name: string }[];
  respond(answer: { kind: "allow" | "deny" } | { kind: "cancelled" }): void;   // idempotent; second call is ignored
}
```

- `allow` selects the agent's `allow_once` option; `deny` selects `reject_once`
  ([03-agents.md mapping](../docs/spec/03-agents.md#mapping-acp-to-agentherd)). If the needed
  option kind is missing, `allow` becomes `cancelled` (never pick `allow_always`), and `deny`
  picks any `reject_*` option, else `cancelled`.
- `toolCall` mapping: `kind`, `title`; `command` from `rawInput.command` when it is a string
  (or an array joined by spaces); `paths` from `locations[].path`.
- `SessionUpdateEvent` `{ sessionId; type: "message" | "tool_call" | "tool_call_update" | "plan" | "other"; text?; toolCall? }`.

**Verify:** `pnpm --filter @agentherd/acp-client typecheck` → exits 0.

### Step 5: Integration tests

`packages/acp-client/test/mock-agent.test.ts`, spawning the real mock-agent bin through a
profile `{ id: "mock", command: ["node", "--import", "tsx", "<path>/bin/mock-agent.ts", "--script", <tmp script>] }`
(or the `tsx` bin directly):

1. allow path: script with `expect: allow_once`; the test responds `allow`; prompt ends with
   `end_turn`; updates include the message text.
2. deny path: `expect: reject_once`; respond `deny`.
3. agent crash: script step `crash: true` (add it) exits the process mid-turn; the pending
   permission resolves `cancelled`; `exit` fires with the stderr tail.
4. cancel: `cancel()` during a pending permission; the prompt ends with `cancelled`.
5. double respond: second `respond` is ignored.

**Verify:** `pnpm test` → all pass, under 20 s total.

### Step 6: Commit

Two commits: `feat(mock-agent): add scripted ACP mock agent` and
`feat(acp-client): start agents from profiles and map ACP permission requests`, each with a
why-body.

## Test plan

Integration tests in Step 5; unit tests for the script parser.

## Done criteria

- [ ] `pnpm check` and `pnpm test` exit 0.
- [ ] ACP SDK types are imported only in `packages/acp-client` and `packages/mock-agent`.
- [ ] No stdout writes in mock-agent outside the ACP stream.
- [ ] `plans/README.md` state set to `DONE`.

## STOP conditions

- The SDK 2.4.0 API differs from "Current state" so that Step 4 cannot be built as written.
  Record the real API in this plan's Maintenance notes, then stop.
- The SDK cannot send `session/request_permission` from the agent side and wait for the
  answer.
- A check fails twice after a fix attempt.

## Maintenance notes

- `allow_always` is never selected. "Always do this" creates an AgentHerd rule instead.
- When Q03 is answered, `answer` decisions may need a new mapping; keep the mapping in one
  function (`toAcpOutcome`).
- Deviations from the steps, found while implementing:
  - Mock script steps also include `stderr` (writes a line to stderr, used to test redaction)
    and `sleep` (abortable, used to test cancel).
  - The mock bin runs with Node's built-in type stripping (`#!/usr/bin/env node`), not tsx.
  - AgentHerd keeps its own session ids; the agent's session id is only used on the wire.
  - `AgentConnection` also exposes `pid` and `stderr()`. A request that fails because the
    agent exited reports the exit code and the redacted stderr tail, not "connection closed".
  - `cancel(sessionId)` answers the session's open permission requests `cancelled` before it
    sends `session/cancel`, as ACP requires.
