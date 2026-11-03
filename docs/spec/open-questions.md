# Open questions

Each question names the spec or plan that depends on it. Close a question by writing the
answer and the evidence (link, command output, date) and, if it changes a decision, an ADR.

| ID | Question | Blocks | Status |
| --- | --- | --- | --- |
| Q01 | Do `claude-agent-acp` and `codex-acp` work with `@agentclientprotocol/sdk` 2.x: permission options offered, `session/load`, cancel? | M4 Claude Code / Codex profiles | Open |
| Q02 | Which other agent CLIs have a working ACP mode today (Gemini CLI, OpenCode, Qwen Code, Goose, Kimi), and the exact command for each | M4 built-in profiles | Open |
| Q03 | How does each agent ask the user a question over ACP: a permission request, a message that ends the turn, or something else? | M2 (`answer`) | Open |
| Q04 | Claude Code permission rule syntax and precedence in `settings.json` (`allow` / `deny` / `ask`, `Bash(prefix:*)`, path rules); can a separate file hold AgentHerd's entries? | M3 exporter-claude-code | Open |
| Q05 | Codex: approval policy, sandbox modes and command rule files (execpolicy) in the current version; what can be expressed per command and per directory? | M3 exporter-codex | Open |
| Q06 | Gemini CLI and OpenCode permission config formats and where they are read from | M3 exporters | Open |
| Q07 | Does `dsh acp` send `session/request_permission` for tool calls under its default approval settings, and which profile/settings make it ask? | M2 | Open |
| Q08 | SQLite driver inside an Electron `utilityProcess`: `node:sqlite` or `better-sqlite3`? | M1 | Open |
| Q09 | Pi packages to depend on (`@earendil-works/pi-agent-core`, the AI provider package) and their stability policy | M3 | Open |
| Q10 | Idle detection for presence | — | Closed 2026-11-04: presence removed (ADR 0012) |
| Q11 | Windows support: named pipe for the local API, agent config paths | after v1 | Deferred: macOS only (ADR 0013) |
| Q12 | `pmset -a disablesleep 1` on current macOS / Apple Silicon: does it keep the system awake with the lid closed on battery and on power? Best way to ask for admin rights from Electron (`osascript ... with administrator privileges` or a helper)? | M2 keep-awake | Open |
