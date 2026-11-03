# 01. Product

## 1. Problem

A developer who runs several coding agents at the same time (Claude Code, Codex, OpenCode,
Gemini CLI and others) spends much of the day as their switchboard:

- An agent stops to ask for permission to run a command that the developer always allows.
- An agent asks a question that the developer answered last week in another session.
- An agent finishes, or gets stuck in a loop, and nobody notices for an hour.
- When the developer leaves the desk, all agents stop at their next prompt.

Each interruption is small. Together they decide how many agents one person can run.

## 2. Product statement

AgentHerd watches the coding agents on your machine. It handles the routine prompts that
have a clear precedent and pings you, one item at a time, only when a decision really needs
you. You answer from your phone in a chat app. Feishu is the first supported chat app.

Tagline: **Herd your coding agents. Only get pinged when it matters.**

## 3. Users

- Primary: an individual developer who runs 2 to 20 agent sessions on one computer and uses
  Feishu (or Lark) every day.
- Later: the same developer with Slack, Telegram or another chat app.
- Not in scope for v1: teams that share one AgentHerd, or agents that run on remote servers.

## 4. Goals for v1

| ID | Goal |
| --- | --- |
| G1 | See every running agent session and its state (working, waiting for approval, asking, stopped, looping, error) in one place. |
| G2 | Get each item that needs you as one Feishu card. Approve, deny or answer from the card. |
| G3 | Let AgentHerd decide routine items by rules and precedent, and show why it decided. |
| G4 | Start new agent tasks from Feishu and follow their progress. |
| G5 | Set up in less than 5 minutes: install, scan one QR code, done. |
| G6 | Supervise every supported agent through one adapter model ([03-agent-adapters.md](03-agent-adapters.md)). |
| G7 | Keep agents and AgentHerd running when the laptop lid is closed (macOS, opt-in). See [02-architecture.md](02-architecture.md#7-keep-running-with-the-lid-closed). |

## 5. Non-goals for v1

- AgentHerd is not a coding agent. It does not edit code itself.
- AgentHerd is not an IDE or a chat UI that replaces the agents' own UIs.
- No cloud service, account system or telemetry backend.
- No team features: shared rules, multiple owners, role-based approval.
- No remote host: AgentHerd and the agents run on the user's computer. Work does not continue
  when that computer is shut down (ADR 0011, option B).
- No mobile app. The chat app is the mobile UI.
- No promise to bypass an agent's own safety settings. AgentHerd answers prompts that the
  agent already shows; it does not turn off the agent's sandbox.

## 6. Success metrics

| Metric | Definition | v1 target |
| --- | --- | --- |
| Interruptions per agent-hour | Items sent to the human, divided by agent working hours | Show the number; reduce it by 50% against `observe` mode |
| Suggestion agreement | Share of observe-mode suggestions that match the human's real answer | ≥ 90% for items the Herder marks high-confidence |
| Wrong auto decisions | Auto decisions that the owner undoes or marks wrong | < 1% |
| Time to first card | From first launch to the first Feishu card | < 5 minutes |
| Time a waiting item waits | From an agent prompt to a decision | Median < 1 minute when the owner is reachable |

## 7. Product principles

1. **Take as little attention as possible.** One item at a time. Group related items. Never
   send a message that does not need an action or that the user did not ask for.
2. **Show the reason.** Every decision, automatic or not, has a short reason and a source
   (rule, precedent, model).
3. **Be easy to undo.** A rule that came from "always allow" can be removed from the card
   history or the desktop app.
4. **Fail toward the human.** If in doubt, ask. If down, let the agent ask on its own.
5. **Earn trust in steps.** `observe` → `assist` → `auto`. See [04-herder.md](04-herder.md#4-modes).
