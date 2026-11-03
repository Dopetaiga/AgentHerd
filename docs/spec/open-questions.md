# Open questions

Each question names the spec or plan that depends on it. Close a question by writing the
answer and the evidence (link, command output, date) and, if it changes a decision, an ADR.

| ID | Question | Blocks | Status |
| --- | --- | --- | --- |
| Q01 | Exact output shape of the Claude Code `PermissionRequest` hook for allow and deny, and whether `updatedInput` is allowed | M2 adapter-claude-code | Open |
| Q02 | Does a Claude Code `Stop` hook with `decision: "block"` make the agent continue with the given reason? Any limit on repeats? | M2 (`continue`) | Open |
| Q03 | Can a hook answer `AskUserQuestion`, or only observe it? | M2 (`answer`) | Open |
| Q04 | While a `PermissionRequest` hook waits, can the user still answer in the terminal? What happens to the hook then? | Claude Code adapter | Open |
| Q05 | Codex app-server: method names and payloads for command and file-change approvals in the current version | M4 adapter-codex | Open |
| Q06 | Codex TUI sessions: is there any hook or `notify` path that can approve, or only observe through session files? | M4 | Open |
| Q07 | Claude Code launch mode: Agent SDK or `claude -p --output-format stream-json`? | M4 | Open |
| Q08 | SQLite driver inside an Electron `utilityProcess`: `node:sqlite` or `better-sqlite3`? | M1 | Open |
| Q09 | Pi packages to depend on (`@earendil-works/pi-agent-core`, the AI provider package) and their stability policy | M3 | Open |
| Q10 | Idle detection for presence | — | Closed 2026-11-04: presence removed (ADR 0012) |
| Q11 | Windows support: named pipe for the local API, hook command quoting | after v1 | Deferred: macOS only (ADR 0013) |
| Q12 | `pmset -a disablesleep 1` on current macOS / Apple Silicon: does it keep the system awake with the lid closed on battery and on power? Best way to ask for admin rights from Electron (`osascript ... with administrator privileges` or a helper)? | M2 keep-awake | Open |
