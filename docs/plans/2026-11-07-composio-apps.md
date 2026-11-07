# Composio apps for agents — implementation plan (phase 2)

> **For agentic workers:** execute task by task, TDD per step (write the test, watch it fail, make it pass), commit after each task. Check each box when done.

**Goal:** Agents (DSH, Codex — anything that takes `mcpServers`) can use the owner's connected apps (Gmail, GitHub, Slack, …) through the `agentherd` MCP server. The owner pastes their own Composio API key in 设置 → 应用连接, connects apps there, and app calls are approved by their read/write hints.

**Architecture:** Core stays offline: it gets an `AppTools` port (list tools, tool hints, call a tool). The gateway (`packages/core/src/mcp-gateway.ts`) becomes async, lists `herd_report` + app tools, and sends every app call through a new `approveAppCall` (pipeline + inbox) before calling the port. The host implements the port with a plain-fetch Composio client (`packages/host/src/composio.ts`: REST v3.1 + a small streamable-HTTP MCP client) and an `Apps` service (`packages/host/src/apps.ts`: key, user id, tool-router session, hints cache, connect/disconnect). The desktop gets an 应用连接 section. The Herder only learns which apps are connected and that Pi cannot use them.

**Tech Stack:** TypeScript (Node 22 / Electron, type stripping — no parameter properties, no enums), vitest, React + Tailwind renderer, biome. No new dependencies (no `@composio/core`): global `fetch` only.

**Spec:** `docs/spec/09-agent-tools.md` §3–§5, ADR `docs/adr/0041-agent-tools-through-a-local-mcp-gateway.md`. Composio API notes: `C:\Users\28694\AppData\Local\Temp\composio-api.md` (copy the facts used into code comments; the temp file is not part of the repo).

## Global Constraints

- No TCP listener in AgentHerd (docs/spec/06-security.md §1). Outgoing HTTPS to `backend.composio.dev` is fine.
- The key lives only in `<home>/secrets.json` under account `composio`; it is never sent to the renderer, the Herder, an agent, the audit log or a channel. `AppsView` says only `hasKey`.
- No path from an error leads to an approved call (same rule as `packages/core/src/pipeline.ts`). Unknown hints → owner.
- The owner said (m03189): "不用问，会话里说发邮件就行" — a write the owner asked for (sending email) is approved without a card in assist mode; only destructive or unknown tools ask.
- Pre-existing Windows test failures stay as they are (core 7, host 8, herder 6, acp-client 1); no new failures.
- Composio facts marked UNVERIFIED (MCP reply format, Gmail hints) are checked live in Task 8 before the PR; code must accept both JSON and SSE replies.

## Review Focus

- `approveAppCall` cannot approve on error, and strictest-wins over the tools of one `COMPOSIO_MULTI_EXECUTE_TOOL` call.
- The key never leaves the host process except as the `x-api-key` header to Composio.
- Session is recreated after key change or connect/disconnect; a stale session error recreates once, not in a loop.

---

## Task 1: App approval in the pipeline

**Files:** `packages/protocol/src/index.ts`, `packages/core/src/pipeline.ts`, `packages/core/test/pipeline.test.ts`

**Interfaces:**
```ts
// protocol
/** Composio tool hints (tags), docs/spec/09-agent-tools.md §3. */
export interface AppHints { readOnly: boolean; create: boolean; update: boolean; destructive: boolean }
// ToolCallInfo gains:  appHints?: AppHints   (kind "app", command = tool slug)
// pipeline
export const APP_READ = "app read";      // reason of a read-only app call approved by hints
export const APP_WRITE = "app write";    // reason of a non-destructive write approved by hints
```

- [ ] Tests: kind "app" items — readOnly → allow, reason APP_READ, in observe too; create/update (not destructive) → allow APP_WRITE in assist, escalate in observe; destructive → escalate risk high; no hints / `appHints` undefined → escalate; a deny rule `{toolKind:"app", command:"GMAIL_*"}` beats readOnly; an allow rule on a destructive slug allows (assist) — rules are the owner's choice.
- [ ] In `decideUnsafe`: skip massDelete/guards for kind "app"; after `matchRules` returns null, if `item.toolCall?.kind === "app"` return `appDefault(item, ctx.mode)` instead of the AUTO_APPROVED branch. Decisions keep `source: "rule"` so `decide()`'s defense still holds.
- [ ] `pnpm vitest run packages/core/test/pipeline.test.ts` — Expected: all pass.
- [ ] Commit `feat(core): approve app calls by their tool hints`.

## Task 2: `approveAppCall`

**Files:** new `packages/core/src/app-calls.ts`, `packages/core/test/app-calls.test.ts`, `packages/core/src/texts.ts`

**Interfaces:**
```ts
export interface AppCall { slug: string; title: string; toolkit: string; args: unknown; hints?: AppHints }
/** Resolves true when the call may run. Never throws; any error resolves false. */
export function approveAppCall(ctx: HerdContext, taskId: string, calls: AppCall[]): Promise<boolean>
```

- [ ] One Item per gateway call (kind "permission", toolCall `{kind:"app", title, command: slug, paths: [], rawInput: args, appHints}`); with several calls (multi-execute) decide each, strictest wins (deny > escalate > allow); the item shows the strictest call, body lists every `title` and the args JSON (≤ 20 lines, values of keys matching /token|secret|password|key/i replaced by "***").
- [ ] Applied allow: insertDecision, item decided, audit `"app.call"` {taskId, slugs, reason}; APP_WRITE also pushes `ctx.texts.appWrite(title)` into `f.task.automaticDecisions` so the report says what was sent.
- [ ] Escalate: registry `waiting-approval`, `ctx.inbox.add(item, {answer: k => resolve(k === "allow")…})`, back to `working` after the answer; ended task → resolve false.
- [ ] Texts zh/en: `appWrite(title)` "已自动执行：${title}" / "Ran on its own: ${title}"; `appDenied(title)` "主人没有允许：${title}" / "The owner did not allow ${title}."
- [ ] Tests with a fake ctx (copy setup from `packages/core/test/e2e/mcp.e2e.test.ts`): read → true no item card; destructive → card, owner allow → true, deny → false; multi with one destructive → card.
- [ ] Commit `feat(core): ask the owner about app calls the hints do not clear`.

## Task 3: Async gateway with app tools

**Files:** `packages/core/src/mcp-gateway.ts`, `packages/core/src/herd-context.ts`, `packages/core/src/herd.ts`, `packages/core/src/index.ts`, `packages/core/test/mcp-gateway.test.ts`, `packages/host/src/mcp-socket.ts`, `packages/host/src/host.ts`, `packages/host/test/mcp-socket.test.ts`

**Interfaces:**
```ts
export interface McpTool { name: string; description?: string; inputSchema: unknown }
export interface AppTools {
  /** Meta tools of the owner's session; [] without a key. */
  list(): Promise<McpTool[]>;
  /** Hints and names for app tool slugs (cached by the host). */
  describe(slugs: string[]): Promise<Map<string, { title: string; toolkit: string; hints?: AppHints }>>;
  /** Runs a tool on the session; the MCP `tools/call` result as Composio returned it. */
  call(name: string, args: unknown): Promise<unknown>;
}
export const DIRECT_META = new Set(["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS"]);
export const MULTI_EXECUTE = "COMPOSIO_MULTI_EXECUTE_TOOL";
// McpGateway: constructor(onReport, approve: (taskId, calls) => Promise<boolean>, apps?: () => AppTools | undefined)
// handle(token, msg): Promise<JsonRpcMessage | undefined>   (unknown token still throws, synchronously checked first)
```

- [ ] tools/list: `[HERD_REPORT_TOOL, ...await apps.list()]` (list failure → only herd_report, audit "apps.error").
- [ ] tools/call: herd_report as before; DIRECT_META → `apps.call`; MULTI_EXECUTE → slugs from `arguments.tools[].tool_slug` (missing/empty → tool error), describe, approve, then call; any other name that `apps.list()` returned → describe [name], approve, call; else "unknown tool". Denied → tool error text `appDenied(title)`; call throws → tool error with the message.
- [ ] Hide meta tools we do not want even if Composio lists them: COMPOSIO_MANAGE_CONNECTIONS, COMPOSIO_REMOTE_WORKBENCH, COMPOSIO_REMOTE_BASH_TOOL, COMPOSIO_PROXY_EXECUTE (filter in `list`, refuse in call).
- [ ] `HerdOptions.apps?: () => AppTools | undefined`; Herd.mcp returns the promise; host `McpHandler` type async: `serveSocket` awaits, keeps per-socket ordering of writes irrelevant (JSON-RPC ids), token hello check stays sync via `taskOf`.
- [ ] Tests: fake AppTools; list merges; read-only multi runs; destructive waits for owner; hidden tools refused; existing herd_report tests updated to `await`.
- [ ] `pnpm vitest run packages/core packages/host/test/mcp` — Expected: only the pre-existing failures.
- [ ] Commit `feat(core): the agentherd MCP server offers the owner's apps`.

## Task 4: Composio client

**Files:** new `packages/host/src/composio.ts`, `packages/host/test/composio.test.ts`

**Interfaces:**
```ts
export const COMPOSIO_API = "https://backend.composio.dev/api/v3.1";
export class ComposioError extends Error { status: number; slug?: string }
export interface ComposioToolkit { slug: string; name: string; logo?: string; description?: string; noAuth: boolean;
  account?: { id: string; status: string } }
export interface ComposioClient {
  checkKey(): Promise<void>;                                  // GET /auth/session/info; 401 → ComposioError
  createSession(userId: string, toolkits: string[]): Promise<{ id: string; mcpUrl: string }>;
  toolkits(sessionId: string, opts?: { search?: string; connected?: boolean }): Promise<ComposioToolkit[]>; // follows next_cursor, ≤ 4 pages
  link(sessionId: string, toolkit: string): Promise<{ url: string; accountId: string }>;
  account(id: string): Promise<{ status: string; toolkit: string }>;
  disconnect(accountId: string): Promise<void>;
  tool(slug: string): Promise<{ slug: string; name: string; toolkit: string; tags: string[] }>;
}
export function composioClient(key: string, fetchFn?: typeof fetch): ComposioClient
export function hintsOf(tags: string[]): AppHints | undefined   // undefined when no hint tag at all
/** Streamable-HTTP MCP client for the session's mcp.url (JSON or text/event-stream replies). */
export interface McpHttpClient { listTools(): Promise<McpTool[]>; callTool(name: string, args: unknown): Promise<unknown> }
export function mcpHttpClient(url: string, key: string, fetchFn?: typeof fetch): McpHttpClient
```

- [ ] Session body: `{user_id, toolkits:{enable: toolkits}, manage_connections:{enable:false}, workbench:{enable:false}}`; a session with no connected toolkits omits `toolkits`.
- [ ] MCP client: lazy `initialize` (protocolVersion "2025-06-18", clientInfo agentherd), keeps `Mcp-Session-Id` header from the reply, sends `notifications/initialized`; headers `x-api-key`, `Accept: application/json, text/event-stream`; parses SSE `data:` lines until the message with the request id; 404 with a session id → re-initialize once.
- [ ] Errors: non-2xx → ComposioError(message from `error.message`, status, slug); network failure → ComposioError status 0.
- [ ] Tests with a fake fetch (record url, method, headers, body): every endpoint path/body above; key header on every request; 401 body → ComposioError slug `APIKey_InvalidAPIKey`; SSE and JSON replies; hintsOf.
- [ ] Commit `feat(host): a Composio client without the SDK`.

## Task 5: Apps service and host API

**Files:** new `packages/host/src/apps.ts`, `packages/host/test/apps.test.ts`, `packages/host/src/config.ts` (CliConfig `apps?: { composioUserId?: string }`), `packages/host/src/api.ts`, `packages/host/src/host.ts`

**Interfaces:**
```ts
export interface AppView { slug: string; name: string; logo?: string; connected: boolean; connecting: boolean }
export interface AppsView { hasKey: boolean; problem?: string; apps: AppView[] }  // connected first, then popular
// HostApi additions (also in HOST_METHODS):
apps(search?: string): Promise<AppsView>;
setComposioKey(key: string): Promise<AppsView>;   // "" removes; checks the key first, bad key → AppsView.problem, not saved
connectApp(slug: string): Promise<{ url: string }>; // the renderer opens it; progress as "apps" events
disconnectApp(slug: string): Promise<AppsView>;
// HostEvent: { topic: "apps"; data: AppsView }
```

- [ ] `Apps` (constructor options: secrets, readConfig/writeConfig, fetchFn, clock, emit): user id `agentherd-<16 hex>` created once in config; session cached and recreated when key or connected set changes; `appTools()` returns AppTools (undefined without key) with `describe` caching `tool()` per slug for 24 h; connect: link → poll `account(id)` every 2 s up to 5 min → ACTIVE: recreate session, emit; FAILED/EXPIRED/REVOKED/timeout: problem text, emit.
- [ ] Host wires `apps: () => this.apps.appTools()` into Herd options; secret account `composio` (comment in `secretFile` lists it).
- [ ] Tests with fake fetch + fake clock: no key → hasKey false and no requests; bad key not saved; connect polling to ACTIVE recreates the session with the toolkit; disconnect deletes the account; key never appears in any emitted view (JSON.stringify check).
- [ ] Commit `feat(host): owners connect apps with their own Composio key`.

## Task 6: 设置 → 应用连接

**Files:** new `apps/desktop/src/renderer/src/components/AppsSection.tsx`, `apps/desktop/src/renderer/src/pages/SettingsPage.tsx`, `apps/desktop/src/renderer/src/store.ts` (apps state + "apps" event), `apps/desktop/src/renderer/src/dev-bridge.ts`, `apps/desktop/src/renderer/src/dev-fixtures.ts`

- [ ] Section「应用连接」after FeishuSection. No key: hint "用你自己的 Composio API Key 连接 Gmail、GitHub 等应用；智能体（不含 Pi）在任务里通过 agentherd 工具使用。" + password input + 保存 (+ link text to composio.dev/settings). With key: rows of apps (logo, name, 已连接/连接中…), buttons 连接 / 断开; search box; 更换 key / 移除 key. `problem` shown in red under the section.
- [ ] 连接 calls `connectApp`, then `window.open(url)` (main process opens https externally).
- [ ] Dev fixtures: `?sim=ready` has key with Gmail connected, GitHub not.
- [ ] `npx tsc --noEmit -p apps/desktop` and `npx electron-vite build` in apps/desktop — Expected: no errors. Check in the dev preview (temp vite config as for PR #46).
- [ ] Commit `feat(desktop): 应用连接 in settings`.

## Task 7: The Herder knows the apps

**Files:** `packages/core/src/herder-port.ts` (HerderHost `apps(): string[]` — connected app names), `packages/core/src/herd.ts`, `packages/herder/src/tools.ts` (session_list line), `packages/herder/src/prompt.ts`, `packages/herder/test/helpers.ts`, `packages/herder/test/tools.test.ts`

- [ ] session_list adds `Connected apps (agents other than Pi use them through the agentherd tools): Gmail, GitHub` or `Connected apps: (none)`.
- [ ] Prompt rule: a task that needs an app (mail, GitHub, Slack, …) starts with `profile` set to an installed non-Pi agent (dsh first); say so in the prompt to the agent ("可用应用：Gmail（通过 agentherd 工具）").
- [ ] Core passes names from an optional `HerdOptions.appNames?: () => string[]` (host: connected names from the last AppsView).
- [ ] Commit `feat(herder): send app tasks to agents that can use apps`.

## Task 8: Docs, live check, PR

- [ ] `docs/spec/09-agent-tools.md` §3: real endpoints, hidden meta tools, `describe` cache; `docs/spec/06-security.md` secrets list adds `composio`.
- [ ] Live check with the owner's key (ask the owner to paste it in the app): connect Gmail, task in DSH "看看我最新的 3 封邮件" → no card, answer lists mails; "给我自己发一封测试邮件" → no card (write), mail arrives, report says 已自动执行; a delete-like tool → card. Record the real Gmail hints and the MCP reply type in the spec, fix code if UNVERIFIED facts were wrong.
- [ ] Full tests `pnpm vitest run` — Expected: only pre-existing failures; `npx biome check` on changed files.
- [ ] Push branch `feat/composio-apps` (from feat/agent-apps until #50 is merged), open PR, merge into try/local, restart the app.
