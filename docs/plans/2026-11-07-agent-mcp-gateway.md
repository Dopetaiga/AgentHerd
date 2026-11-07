# Agent MCP gateway and herd_report — Implementation Plan

> **For agentic workers:** execute task by task. Each task: write the failing test, watch it fail,
> write the code, watch it pass, commit. Do not skip the "watch it fail" step.

**Goal:** every ACP agent AgentHerd starts gets one stdio MCP server, `agentherd`, whose
`herd_report` tool sets the task's report (state + summary) on the board. This is PR 1 of
[docs/spec/09-agent-tools.md](../spec/09-agent-tools.md); Composio apps are PR 2.

**Architecture:** the host listens on a local socket (`<home>/run/mcp.sock`, Windows named pipe
`\\.\pipe\agentherd-mcp-<hash>`). Each task gets a 32-byte token. `session/new` and `session/load`
pass `mcpServers: [{name:"agentherd", command:<host node>, args:[agentherd-mcp], env:[socket, token]}]`.
The relay script connects to the socket, sends `{"token":…}` as its first line, then pipes
JSON-RPC lines both ways. The host hands each message to `Herd.mcp(token, msg)`, which the core's
`McpGateway` answers (initialize, ping, tools/list, tools/call herd_report).

**Tech stack:** TypeScript (Node strip-types: no parameter properties, no enums), vitest, biome,
`@agentclientprotocol/sdk` 2.4.0, `node:net`.

**Spec:** [09-agent-tools.md §1–§2, §4–§5](../spec/09-agent-tools.md),
[ADR 0041](../adr/0041-agent-tools-through-a-local-mcp-gateway.md).

## Global constraints

- No TCP listener ([06-security.md §1](../spec/06-security.md)); socket/pipe only, token per task.
- No new dependencies.
- Profiles may opt out with `mcp: false`; Pi (`pi-acp`) ignores `mcpServers` — harmless.
- Errors inside `tools/call` are tool results with `isError: true`; unknown methods `-32601`.
- Run commands from `G:\School\AgentHerd` in pwsh. Pre-existing Windows failures (same on main):
  core 7, herder 6, pi-acp 3, acp-client 1, host agents 7 — do not count them as regressions.
- Run biome only on touched files (`npx biome check --write <files>`), never a whole directory
  (it rewrites CRLF files).

## Review focus

- Token check happens before any message reaches the core; a revoked token is refused.
- `session/load` gets the same server list as `session/new` (resumed tasks keep the tool).
- A `herd_report` does not survive into the next turn (cleared at turn start).

---

## Task 1 — acp-client passes MCP servers

**Files:** `packages/acp-client/src/connection.ts`, `packages/acp-client/src/index.ts`,
`packages/mock-agent/src/agent.ts`, `packages/acp-client/test/connection.test.ts`.

**Interface:**

```ts
export interface StdioMcpServer {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
}
newSession(cwd: string, mcpServers?: StdioMcpServer[]): Promise<string>;
loadSession(sessionId: string, cwd: string, mcpServers?: StdioMcpServer[]): Promise<void>;
```

- [ ] Test: mock-agent logs `mcp <name> <command>` (via its existing `log`) for each server in
      `session/new` / `session/load`; test starts a session with one server and asserts the log
      (the mock writes its log to the file named by env `MOCK_AGENT_LOG`, as existing load tests do).
- [ ] Run `npx vitest run packages/acp-client/test/connection.test.ts` — Expected: new test fails.
- [ ] Implement: default `[]`, send `mcpServers` instead of the literal `[]`; export the type.
- [ ] Re-run — Expected: new test passes; only the known POSIX failure remains.
- [ ] Commit `feat(acp-client): pass MCP servers to new and loaded sessions`.

## Task 2 — core McpGateway

**Files:** new `packages/core/src/mcp-gateway.ts`, `packages/core/src/index.ts`,
new `packages/core/test/mcp-gateway.test.ts`.

**Interface:**

```ts
export type JsonRpcMessage = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: unknown; result?: unknown; error?: unknown };
export class UnknownTokenError extends Error {}
export interface HerdReport { state: ReportState; summary: string; changes?: string[]; tests?: string[]; risks?: string[]; links?: string[] }
export const HERD_REPORT_TOOL: { name: "herd_report"; description: string; inputSchema: object };
export function parseReport(input: unknown): HerdReport | string; // string = validation error
export class McpGateway {
  constructor(onReport: (taskId: string, report: HerdReport) => void);
  register(taskId: string): string;      // 64 hex chars, randomBytes(32); same task → new token
  revoke(taskId: string): void;
  taskOf(token: string): string | undefined;
  handle(token: string, msg: JsonRpcMessage): JsonRpcMessage | undefined; // undefined for notifications
}
```

Behaviour: `initialize` answers `protocolVersion` = the client's if it is `2025-06-18` or
`2025-03-26`, else `2025-06-18`; `capabilities: {tools: {}}`; `serverInfo {name:"agentherd"}`.
`ping` → `{}`. `tools/list` → `{tools:[HERD_REPORT_TOOL]}`. `tools/call` herd_report → valid:
`onReport`, result `{content:[{type:"text",text:"reported"}]}`; invalid: `isError:true` with the
reason; unknown tool: `isError:true`. Other methods with id → error `-32601`. Notifications → no
answer. Unknown token → throw `UnknownTokenError`. `summary` longer than 600 is cut to 600.

- [ ] Tests for each behaviour above (pure unit, no agent).
- [ ] Run `npx vitest run packages/core/test/mcp-gateway.test.ts` — Expected: fails (module missing).
- [ ] Implement; re-run — Expected: all pass.
- [ ] Commit `feat(core): MCP gateway with herd_report`.

## Task 3 — core wiring

**Files:** `packages/protocol/src/index.ts` (AgentProfile `mcp?: boolean`),
`packages/core/src/herd-context.ts` (Following `report?: HerdReport`; HerdOptions
`mcpServer?: (token: string) => StdioMcpServer`; HerdContext `mcp: McpGateway`),
`packages/core/src/herd.ts` (build gateway, `mcp(token, msg)` method), `packages/core/src/task-runner.ts`
(every `newSession`/`loadSession` call gets `servers(f)`; revoke in `endTask`; `delete f.report` at
the start of `runTurn`), `packages/core/src/task-report.ts` (`applyReport(ctx, f, report)`: set
`f.report`, audit `task.herd_report`, `restage`; `restage` passes `report: f.report` to `stageOf`),
new `packages/core/test/e2e/mcp.e2e.test.ts`.

```ts
// task-runner.ts
private servers(f: Following): StdioMcpServer[] {
  const make = this.ctx.opts.mcpServer;
  if (make === undefined || f.profile.mcp === false) return [];
  return [make(this.ctx.mcp.register(f.id))];
}
```

- [ ] e2e test (no real socket): Herd with `mcpServer: (t) => ({name:"agentherd",command:"x",args:[],env:[{name:"T",value:t}]})`;
      mock script turn sleeps 300 ms; while it runs, test reads the token from the mock log line,
      calls `herd.mcp(token, tools/call herd_report {state:"blocked", summary:"need keys"})`,
      expects result `reported`, and after the turn `herd.tasks()[0]?.stage === "stuck"`.
- [ ] Second test: after `endTask`, `herd.mcp(token, ping)` throws `UnknownTokenError`.
- [ ] Third test: profile `mcp: false` → mock log has no `mcp` line.
- [ ] Run `npx vitest run packages/core/test/e2e/mcp.e2e.test.ts` — Expected: fails.
- [ ] Implement; re-run — Expected: pass; `npx tsc -p packages/core --noEmit` clean.
- [ ] Run full core tests — Expected: only the 7 known failures.
- [ ] Commit `feat(core): agents report through herd_report`.

## Task 4 — host socket and relay

**Files:** new `packages/host/src/mcp-socket.ts`, new `packages/host/bin/agentherd-mcp.ts`,
`packages/host/src/host.ts` (Herd option `mcpServer`, `Host.mcp(token,msg)`),
`packages/host/src/run.ts` (start `serveMcp` beside `serveApi`, close on stop),
new `packages/host/test/mcp-socket.test.ts`.

```ts
export function mcpSocketPath(home: string, platform = process.platform): string;
// win32: `\\\\.\\pipe\\agentherd-mcp-${sha256(home.toLowerCase()).slice(0,16)}`; else join(home,"run","mcp.sock")
export function serveMcp(path: string, handle: (token: string, msg: JsonRpcMessage) => JsonRpcMessage | undefined): Promise<{ path: string; close(): Promise<void> }>;
export function mcpServerFor(socket: string, token: string): StdioMcpServer;
// { name:"agentherd", command: process.execPath, args:[RELAY_BIN],
//   env:[{AGENTHERD_MCP_SOCKET},{AGENTHERD_MCP_TOKEN}, ...nodeEnv() as pairs] }
```

Socket protocol: newline-delimited JSON. First line `{"token":"…"}`; unknown token → write
`{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"unknown task token"}}` and close.
Bad JSON → `-32700`. Then each line → `handle` → answer line (if any). On POSIX mkdir `run`
(0700), unlink stale socket, chmod 0600, as `serveApi` does.

Relay (`agentherd-mcp.ts`, plain TS without parameter properties): connect to
`AGENTHERD_MCP_SOCKET`, send the token line, pipe stdin → socket and socket → stdout, exit 0 when
either side ends; missing env → stderr message, exit 2.

- [ ] Tests: serveMcp answers `ping` for a good token; refuses a bad token with -32001; -32700 on
      bad JSON; relay spawned with `process.execPath RELAY_BIN` relays `tools/list` end to end.
- [ ] Run `npx vitest run packages/host/test/mcp-socket.test.ts` — Expected: fails.
- [ ] Implement; re-run — Expected: pass; `npx tsc -p packages/host --noEmit` clean.
- [ ] Commit `feat(host): local MCP socket and relay for agents`.

## Task 5 — end to end with a real agent process

**Files:** `packages/mock-agent/src/script.ts` (step `mcp_call: {tool, arguments}`),
`packages/mock-agent/src/agent.ts` (remember the session's `mcpServers`; `mcp_call` spawns the
first stdio server, sends initialize + `notifications/initialized` + tools/call, sends the result
text as an agent message), new `packages/host/test/mcp.e2e.test.ts`.

- [ ] Test: Herd built with `mcpServer: (t) => mcpServerFor(socket, t)` and `serveMcp` on a temp
      socket; mock turn `mcp_call: {tool: herd_report, arguments: {state: blocked, summary: "need keys"}}`;
      expect agent message `reported` and stage `stuck`.
- [ ] Run — Expected: fails (unknown step).
- [ ] Implement; re-run — Expected: pass.
- [ ] Commit `test: herd_report end to end through the relay`.

## Task 6 — docs and PR

- [ ] `docs/spec/03-agents.md`: profile field `mcp`; session/new carries the agentherd server.
- [ ] `docs/spec/04-herder.md` §2: herd_report is now delivered by the gateway.
- [ ] `docs/spec/06-security.md` §1: trust row for the MCP socket + per-task token.
- [ ] `docs/spec/open-questions.md`: close Q14 (all ACP agents take stdio MCP; Pi ignores it).
- [ ] biome on touched files; tsc for protocol, acp-client, core, host, mock-agent.
- [ ] Push branch `feat/agent-apps`, open PR "feat: agents report through a local MCP gateway".
- [ ] Merge into local `try/local`, restart the app, run a Codex task and check the audit has
      `task.herd_report` (Codex tends to call it when told; if not, note it in the PR).

## Self-review

- Spec §1 (socket, token, relay, MCP subset, `mcp:false`) → T2, T4; §2 → T2, T3; §4 failures
  (bad token, relay without env) → T4; §5 tests → T2–T5. §3 Composio is out of scope (PR 2).
- Names used consistently: `McpGateway`, `StdioMcpServer`, `mcpServerFor`, `serveMcp`,
  `mcpSocketPath`, `HerdReport`, `applyReport`.
