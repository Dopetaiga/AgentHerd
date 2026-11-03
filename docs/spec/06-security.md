# 06. Security

AgentHerd can approve commands on the user's machine from a phone. A mistake in AgentHerd is
a mistake with the user's shell. This spec lists the rules that keep that power bounded.

## 1. Trust boundaries

| Boundary | Rule |
| --- | --- |
| Chat app → core | Only the owner's id is accepted. Every inbound action names an existing open item; anything else is dropped. |
| Hook bridge → core | Unix socket with mode `600` in a directory with mode `700`. No TCP listener. |
| Renderer → main → core | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The preload exposes typed methods only. |
| Herder model → decisions | Model output is data. It is parsed against a schema; on a parse error the item is escalated. The guard list runs before any model. |
| Agent content → Herder prompt | Agent output (commands, files, transcripts) is untrusted. It is quoted as data in prompts and can never change rules, mode or presence. |

## 2. Secrets

- App Secret and model keys live in the OS keychain through Electron `safeStorage`.
- Logs, `herd.db`, cards and model prompts are passed through a redaction step: known secret
  formats (API keys, tokens, private keys) and values of variables whose names contain
  `KEY`, `TOKEN`, `SECRET` or `PASSWORD` are replaced with `«redacted»`.
- A card never shows full file contents. It shows the command, the path, and at most 20
  lines of diff.

## 3. Failure behavior

- Core not running, socket missing, timeout, crash, invalid model output: the hook returns
  `defer`, and the agent asks the user in its own UI. AgentHerd never answers "allow" because
  of an error.
- Channel disconnected: items stay in the inbox and show in the desktop app; presence falls
  back to `desk` behavior for new items.
- Hooks are only written by an explicit user action in the desktop app, with a backup and a
  one-click removal.

## 4. What is logged

Every decision with its source, reason, the matching rule or precedents, and the owner
action. This audit log is local and can be exported. It is never uploaded.

## 5. Out of scope

AgentHerd does not defend against an attacker who already runs code as the user. It does
not replace the agent's own sandbox.
