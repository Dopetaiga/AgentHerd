# 07. Delivery

## 1. Milestones

| ID | Name | Result | Exit criteria |
| --- | --- | --- | --- |
| M0 | Spec freeze | Specs 00–07 and ADRs 0001–0017 accepted | Done 2026-11-04: baseline 0.1.0 Frozen |
| M1 | Headless loop | `core`, `rules` (guard list + matcher), `acp-client`, `mock-agent`, `channel-feishu`, run from a CLI | E2E-APPROVE and E2E-OWNER-ONLY pass with `mock-agent` and a fake channel; one manual run with real Feishu |
| M2 | DSH + desktop shell | DSH profile (`dsh acp`), `run` command from Feishu, desktop app with onboarding (QR, model choice), sessions list, read-only inbox, mode switch, keep-awake switch | A DSH task started from Feishu asks for approval and is approved from Feishu |
| M3 | Herder + rule export | Guard list, L0 rules, "Always do this", resident Herder per project (tools, compaction, restore), optional pre-filter, observe metrics, decision memory; exporters for Claude Code and Codex, with export status per rule | Observe mode reports agreement on a replayed item set; exported Claude Code config passes `plan()` tests for every rule shape |
| M4 | More agents | Built-in profiles for Claude Code (`claude-agent-acp`), Codex (`codex-acp`), Gemini CLI, OpenCode; exporters for Gemini CLI and OpenCode | Verified on a machine where these agents can run |
| M5 | Release | Signed and notarized macOS build, auto-update, README with GIF | Fresh-machine install to first card in < 5 minutes |

Each milestone is split into plans under [`plans/`](../../plans/README.md).

## 2. Definition of done for a plan

- The code passes `pnpm check` (lint, typecheck) and the tests listed in the plan.
- Specs and ADRs changed in the same commit when behavior changed (see AGENTS.md).
- New user-visible or protocol-visible behavior has an E2E scenario below.
- The plan state in `plans/README.md` is updated.

## 3. Testing

- **E2E first.** Scenarios run the real core with `mock-agent` (a real ACP server) and `channel-fake` (an
  in-memory channel that records what it sent and lets the test click buttons).
- **Channel contract tests** run against every channel. Feishu runs them against recorded
  payloads; a manual checklist covers the real service.
- **Unit tests** only where E2E cannot reach: rule matching, guard list, redaction, command
  normalization, schema parsing.
- **Real agents.** On some development machines, endpoint-security software blocks Claude
  Code and Codex from starting (seen on 2026-11-04: the process is killed by SIGKILL at
  exec). Work for those agents is therefore developed against recorded ACP transcripts and
  config files stored under `fixtures/`, and verified on a machine where the agent can run.

## 4. E2E scenarios

| ID | Scenario | Milestone |
| --- | --- | --- |
| E2E-APPROVE | Mock agent requests approval; card is sent; owner taps Allow; the agent receives allow; card shows final state | M1 |
| E2E-REMIND | An open item gets a reminder after `remindMinutes`; nothing is decided by time | M1 |
| E2E-CHANNEL-DOWN | Channel disconnected; a new item waits in the inbox and is sent after reconnect | M2 |
| E2E-OWNER-ONLY | A non-owner taps a button; nothing changes; event is logged | M1 |
| E2E-DUPLICATE-ACTION | Owner taps Allow twice; the decision is applied once | M1 |
| E2E-EXPORT-NARROW | A rule the target cannot express exactly is exported narrower or skipped, never wider, and shows its export status | M3 |
| E2E-EXPORT-REMOVE | `remove` restores the agent config byte-for-byte except for content the user added | M3 |
| E2E-ALWAYS-RULE | Owner taps "Always do this"; the next equal request is allowed by rule in `assist` mode | M3 |
| E2E-GUARD | A guarded command is never auto-allowed in any mode | M3 |
| E2E-OBSERVE-AGREEMENT | Observe mode stores suggestions and computes agreement | M3 |
| E2E-LOOP | Three identical stops mark the session `looping` and send one notification | M3 |
| E2E-RUN-FROM-CHAT | `run <dir> <prompt>` starts a launch-mode session and reports completion | M2 |
