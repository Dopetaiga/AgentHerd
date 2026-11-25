# ADR 0105: ZCode, the owner's own account behind the zcode-acp bridge

- Status: Accepted
- Date: 2026-11-24
- Changes: [ADR 0104](0104-antigravity-the-owners-own-agy.md) (the owner's own agents), [ADR 0069](0069-claude-code-the-owners-own-or-downloaded.md) (which agents there are)

## Context

- The owner pays for a ZCode plan and wants to say 「用 ZCode 跑这个任务」 in AgentHerd and get the
  usual approvals and report.
- ZCode's backend is driven over ACP by the community bridge `zcode-acp`
  ([source](https://github.com/william0wang/zcode-acp), npm `zcode-acp-server`, version 0.88.0 at
  the time of writing): `zcode-acp server` speaks ACP over stdio and starts
  `zcode app-server --stdio` itself. AgentHerd ships neither; both updates are the owner's.
- The bridge owns backend discovery: an explicit `ZCODE_BIN` first, then `zcode` on its own
  `PATH`, then the backend bundled with ZCode Desktop (Windows registry included), with
  `ZCODE_NODE` naming a Node binary when one is needed. A second locator in AgentHerd could
  disagree with the bridge (checked live: with `ZCODE_BIN` unset and no CLI on `PATH` the bridge
  picked the desktop backend of the owner's machine).
- A `session/new` is lazy: the bridge answers with a placeholder id and starts the real backend
  session on the first operation. Its mode defaults to `yolo` (unrestricted), taken from the
  user's `session.mode` setting before `ZCODE_ACP_MODE` — no launch environment can establish the
  effective mode.
- Checked live (Windows 10.0.26200, bridge 0.88.0, desktop backend ≥ 3.18 wire shape; evidence in
  `openspec/changes/support-zcode-acp/evidence/`): `session/set_mode` materializes the session,
  and the bridge then re-reads the authoritative mode from the backend and reports it as
  `current_mode_update`. A pending session, a backend it cannot read, or the mode reported at
  `session/new` (the default) is not such a confirmation. Permission requests arrive as ACP
  `session/request_permission` after a `tool_call` update, with `allow_once`/`reject_once` kinds
  and the full command in `rawInput`.
- Mode behavior on the same setup: `build` asks for file writes and commands; `guarded` and `edit`
  run writes themselves and ask only for shell commands the backend recognizes as dangerous
  (`rm -rf` asked; a Windows `cmd /c del /f /s /q` did not).

## Decision

1. **A built-in agent named 「ZCode」** (id `zcode`). It is the owner's own install:
   `AGENTHERD_ZCODE`, then `zcode-acp` on `PATH`. It is not shipped or downloaded. It starts as
   `zcode-acp server` — the explicit argument selects the stdio server even if a launcher could
   open a terminal UI.
2. **The bridge owns backend discovery.** An explicit `ZCODE_BIN` or `ZCODE_NODE` in the
   environment passes through to the bridge process; an unset one stays unset. AgentHerd keeps no
   backend locator and injects no model credentials: the profile has `ownModels` (ADR 0104), the
   account and its models stay inside ZCode.
3. **The session's permission mode is established before work.** The profile carries
   `mode: "build"`. Before the first prompt of a new, loaded or replaced session — replayed task
   history included — the ACP client sends `session/set_mode` and counts the mode as established
   only when the running session itself reports it back (`current_mode_update` naming the
   requested mode). On refusal, silence, a report naming another mode, or an exit, the connection
   closes and the task fails with the reason; nothing is dispatched. `build` is the mode whose
   behavior the qualification demonstrates: writes and commands ask over ACP, denial leaves the
   target untouched, and a separate approval lets a separate action run.
4. **Only when the owner names it.** It spends the owner's ZCode quota, so AgentHerd never picks
   it: the Herder passes `profile zcode` when the owner asks for ZCode or zcode, an unnamed task
   fails rather than starting ZCode (even when it is the only installed agent), and recovery
   neither substitutes ZCode for other tasks nor leaves a ZCode task for another agent — a ZCode
   task retries ZCode and waits for the owner's choice when that fails, recognized by the saved
   profile id even when its executable is gone.
5. **On the Agent page** as a row with what it is, where the bridge was found, and, when the
   bridge is missing or it reports a missing backend or unusable sign-in, what to check — with
   credentials redacted as on every other error path. The 验证 button uses the same session
   preparation, so it reports the stage actually reached; passing it means the backend session
   started and the mode was confirmed, not that a particular plan was billed.

## Alternatives

- **`guarded` mode.** Its approval covers only shell commands the backend's own classifier finds
  dangerous; file writes and ordinary commands run without the owner. AgentHerd's pipeline exists
  so the owner decides — `build` is the mode that asks for both (checked live).
- **Trusting `ZCODE_ACP_MODE` or the mode menu.** The bridge reads the user's `session.mode`
  setting before the environment, and the reported default of a pending session is not evidence;
  only a live confirmation counts.
- **A second backend locator in AgentHerd.** The desktop page and the worker could disagree about
  which ZCode runs; the bridge already handles the CLI on `PATH` and the desktop bundle.
- **Picking ZCode automatically for GLM models.** The owner's AgentHerd-configured GLM models run
  in Pi with the owner's key; ZCode runs on a different account and quota.

## Consequences

- ZCode works only where the owner installed the bridge and a backend, and signed in.
- The bridge and backend update independently of AgentHerd; a mode or permission shape that stops
  matching fails the task's start with the reason instead of running unverified.
- A saved ZCode task whose bridge was removed cannot restart: the owner is told and chooses what
  happens next; no other account or agent starts by itself.
- What a task costs is on the owner's ZCode account, not in AgentHerd's usage numbers.

## Tests

- `packages/acp-client/test/connection.test.ts` "prepareSession (ADR 0105)": confirmed, refused,
  wrong report, silent, self-reported mode, exit, and that open/load/setModel still work;
  `mapping.test.ts` "ZCode permission requests".
- `packages/core/test/e2e/prepare.e2e.test.ts`: mode confirmed before the first prompt; refused
  or mismatched mode dispatches nothing; load re-verifies; failed load replaces and prepares; a
  rejected named model fails with the agent's own reason; ordinary tasks never fall back to
  ZCode; a ZCode task whose agent is gone waits for the owner.
- `packages/host/test/agents.test.ts` "ZCode (ADR 0105)": found on `PATH`, `server` argument,
  `ownModels` + `mode`, `ZCODE_BIN`/`ZCODE_NODE` passthrough and absence of model env;
  `profiles.test.ts` known-profile list.
- Live: the qualification runs in `openspec/changes/support-zcode-acp/evidence/` and the PR's
  verification section.
