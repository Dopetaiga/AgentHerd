# Qualification record: zcode-acp bridge (tasks 1.1–1.3)

Date: 2026-11-24. Machine: Windows 10.0.26200 x64 (os release `10.0.26200`), harness under Node
v24.22.2. Both runs drove the installed bridge with AgentHerd's client capabilities
(`initialize` with `fs` read/write off, no terminal; `clientInfo` agentherd) in a disposable
project under `%TEMP%`; every saved value is redacted (user home → `~`, temp root → `%TEMP%`,
e-mail and token-like strings removed). Raw evidence: [`harness/run-2026-11-24T10-09-39.json`](harness/run-2026-11-24T10-09-39.json)
(main run, cases A–D) and [`harness/modes-run.json`](harness/modes-run.json) (mode probe).
Harnesses: [`harness/qualify.ts`](harness/qualify.ts), [`harness/qualify-modes.ts`](harness/qualify-modes.ts).

- Bridge: `zcode-acp-server` **0.88.0** (npm shim on `PATH`, resolved via PATHEXT to the `.cmd`
  shim; run as `zcode-acp server`).
- Owner environment during the run: `ZCODE_BIN` = desktop entry `…\resources\glm\zcode.cjs`,
  `ZCODE_NODE` = a standalone Node 22.23.2, `ZCODE_ACP_MODE` unset.
- Account indicator (non-secret): `session/new` `_meta.zcode.providers` lists the account's
  providers and its default model (`openai/glm-5.3` from the account's first selectable
  provider). No usage/quota reading was recorded — **quota attribution remains unverified**.
- Bridge auth method: `zcode-credentials` ("ZCode built-in credentials" — the desktop app's
  credential files under `~/.zcode/v2`; no editor-side credentials).

## Task 1.1 — startup, versions, backend selection

| Case | Bridge env | Observed |
| --- | --- | --- |
| A (automatic discovery) | `ZCODE_BIN` and `ZCODE_NODE` deleted | `initialize` answers agentVersion 0.88.0; `session/new` answers lazily (placeholder session, no backend operation yet); `session/set_mode` then started the real backend session and confirmed the mode |
| B (explicit override) | `ZCODE_BIN` + `ZCODE_NODE` passed through | Same protocol path; this matches the production environment (desktop backend selected) |
| D (missing backend) | `ZCODE_BIN` → a nonexistent path | `initialize` and the lazy `session/new` still succeed; the first real operation (`session/set_mode`) fails, and the bridge's stderr shows the backend reader exiting |

The standalone CLI was not installed on this machine, so the "CLI on `PATH` wins with both
present" branch was not re-run live; it is covered by the proposal's earlier resolver checks
(proposal §Evidence) and is not asserted by AgentHerd (discovery is the bridge's own).

Separation verified: initialization and session creation succeed with **no backend session**;
the backend session starts at the first real operation. With a missing backend that operation
fails with a usable failure instead of a confirmation.

## Task 1.2 — establishing and confirming the approval mode

`session/set_mode` (spec spelling, `{sessionId, modeId}`) is the operation. Confirmed live on a
new session (A), on the same session again (B), on a **loaded** session (C), and on a
**replacement** session after a failed load (C):

- The bridge answers the RPC and then emits `config_option_update` plus a
  `current_mode_update` carrying the mode **re-read from the backend**; the RPC response's
  session read also shows the backend's own projection (`mode`, `pendingPermissions: []`).
- AgentHerd counts the mode as established only when that `current_mode_update` names the
  requested mode. What does **not** count, and was verified not to be conflated:
  - the mode `session/new` reports (the default, `yolo` on this machine);
  - the loaded session's state (after `session/load` no `current_mode_update` arrives; the
    harness recorded `null` there and required the post-`set_mode` report anyway);
  - a pending session (a failed `set_mode` on a missing backend produces an error, not a
    confirmation — case D);
  - a session that reports another mode after the request (the mismatch is rejected; see the
    `set_mode: wrong` unit tests in `packages/acp-client/test/connection.test.ts`).
- The modes the backend advertises: `plan`, `build`, `edit`, `guarded`, `yolo`.

## Task 1.3 — approval round trip (deny / allow / side effects)

Main run (mode `guarded`, explicit backend): **zero** `session/request_permission` events — an
outside-workspace write and a Windows-style `cmd /c del /f /s /q` both executed without asking.

Mode probe (one session, mode switched between turns, every action on a disposable target):

| Mode | `rm -rf` on a disposable folder | Write outside the workspace |
| --- | --- | --- |
| `guarded` | **asked**; denied → folder intact | not asked (file was created) |
| `edit` | **asked**; denied → folder intact | not asked (file was created) |
| `build` | **asked**; denied → folder intact | **asked**; denied → no file created |

Permission request shape (observed): arrives after a `tool_call` update with the same
`toolCallId`; `toolCall.rawInput` carries the full command (`{"command": "rm -rf …",
"description": …}`) or the file write (`file_path`, `content`); options are ACP kinds
(`allow_once`, `reject_once`, …). Denial blocks the effect; the allow path (one-time option
selection) is covered by AgentHerd's mapping tests and the mock-agent E2E round trip.

External-action tools: with a harmless network read (`https://example.com` page title) the
backend's `WebFetch` tool ran in `guarded` mode without an approval request. In `build` it
follows the same ask path as other tools (same permission channel); a dedicated live deny/allow
round trip for the web tool was not run — **marked unverified**.

## Conclusion

- The bridge/backend **can** confirm a mode authoritatively, and in mode `build` approval
  requests reach the client before execution, with denial preventing the effect. The proposal's
  stop condition is **not** triggered.
- AgentHerd therefore adopts `build` as the profile's `mode` (ADR 0105): it is the mode whose
  approval behavior the qualification demonstrates — writes and commands ask; `guarded`/`edit`
  let the backend run writes itself.
- Residual limits: the backend's dangerous-command classifier is bash-centric (a Windows `cmd
  del` did not ask in any mode); quota attribution is unverified; the web tool's deny/allow
  round trip was not exercised live; the "CLI on PATH with both present" branch of backend
  discovery was not re-run on this machine.
