# 07. Delivery

## 1. Milestones

| ID | Name | Result | Exit criteria |
| --- | --- | --- | --- |
| M0 | Spec freeze | Specs 00–07 and ADRs 0001–0014 accepted | Baseline 0.1.0 marked Frozen |
| M1 | Headless loop | `core` + `adapter-mock` + `channel-feishu`, run from a CLI | E2E-APPROVE and E2E-OWNER-ONLY pass with a fake channel; one manual run with real Feishu |
| M2 | ACP + desktop shell | `adapter-acp` (launch, tested with `dsh acp`), `run` command from Feishu, desktop app with onboarding (QR, model choice), sessions list, read-only inbox, mode switch, keep-awake switch | A DSH task started from Feishu asks for approval and is approved from Feishu |
| M3 | Herder | Guard list, L0 rules, "Always do this", L1, L2, observe metrics, decision memory | Observe mode reports agreement on a replayed event set |
| M4 | More agents | `adapter-claude-code` (attach) with `hook`, `adapter-codex` (launch + attach observe) | Verified on a machine where Claude Code and Codex can run |
| M5 | Release | Signed and notarized macOS build, auto-update, README with GIF | Fresh-machine install to first card in < 5 minutes |

Each milestone is split into plans under [`plans/`](../../plans/README.md).

## 2. Definition of done for a plan

- The code passes `pnpm check` (lint, typecheck) and the tests listed in the plan.
- Specs and ADRs changed in the same commit when behavior changed (see AGENTS.md).
- New user-visible or protocol-visible behavior has an E2E scenario below.
- The plan state in `plans/README.md` is updated.

## 3. Testing

- **E2E first.** Scenarios run the real core with `adapter-mock` and `channel-fake` (an
  in-memory channel that records what it sent and lets the test click buttons).
- **Channel contract tests** run against every channel. Feishu runs them against recorded
  payloads; a manual checklist covers the real service.
- **Unit tests** only where E2E cannot reach: rule matching, guard list, redaction, command
  normalization, schema parsing.
- **Real agents.** On some development machines, endpoint-security software blocks Claude
  Code and Codex from starting (seen on 2026-11-04: the process is killed by SIGKILL at
  exec). Adapters for real agents therefore must be developed against recorded hook payloads
  and protocol transcripts stored under `fixtures/`, and verified on a machine where the
  agent can run.

## 4. E2E scenarios

| ID | Scenario | Milestone |
| --- | --- | --- |
| E2E-APPROVE | Mock agent requests approval; card is sent; owner taps Allow; the agent receives allow; card shows final state | M1 |
| E2E-REMIND | An open item gets a reminder after `remindMinutes`; nothing is decided by time | M1 |
| E2E-CHANNEL-DOWN | Channel disconnected; an attach-mode request returns `defer`; a launch-mode item is sent after reconnect | M2 |
| E2E-OWNER-ONLY | A non-owner taps a button; nothing changes; event is logged | M1 |
| E2E-DUPLICATE-ACTION | Owner taps Allow twice; the decision is applied once | M1 |
| E2E-CORE-DOWN | Core is not running; the hook returns `defer` within 1 s | M4 |
| E2E-ALWAYS-RULE | Owner taps "Always do this"; the next equal request is allowed by rule in `assist` mode | M3 |
| E2E-GUARD | A guarded command is never auto-allowed in any mode | M3 |
| E2E-OBSERVE-AGREEMENT | Observe mode stores suggestions and computes agreement | M3 |
| E2E-LOOP | Three identical stops mark the session `looping` and send one notification | M3 |
| E2E-RUN-FROM-CHAT | `run <dir> <prompt>` starts a launch-mode session and reports completion | M2 |
