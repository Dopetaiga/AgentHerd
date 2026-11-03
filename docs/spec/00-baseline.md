# 00. Baseline

- Baseline version: 0.1.0
- Status: Draft. Waiting for maintainer review. Freeze it before the first implementation plan runs.
- Date: 2026-11-04

## What the baseline is

The baseline is the set of specs and ADRs that the first implementation follows. When the
baseline is frozen, a change to a frozen decision needs a new ADR and a baseline version bump.

## Contents

| Doc | Topic |
| --- | --- |
| [01-product.md](01-product.md) | Problem, users, goals, non-goals, success metrics |
| [02-architecture.md](02-architecture.md) | Processes, packages, data flow, local API |
| [03-agent-adapters.md](03-agent-adapters.md) | How AgentHerd observes and controls each coding agent |
| [04-herder.md](04-herder.md) | The decision pipeline, modes, decision memory |
| [05-channels.md](05-channels.md) | How AgentHerd reaches the user; Feishu is the first channel |
| [06-security.md](06-security.md) | Trust boundaries, secrets, failure behavior |
| [07-delivery.md](07-delivery.md) | Milestones, testing, acceptance criteria |
| [glossary.md](glossary.md) | Terms used in code, UI and docs |
| [open-questions.md](open-questions.md) | Questions that block or shape later work |

Accepted decisions are in [../adr/README.md](../adr/README.md).

## Frozen defaults (0.1.0)

These defaults hold until an ADR changes them.

1. The Herder runs on the user's machine. AgentHerd has no server of its own.
2. When AgentHerd cannot decide, or is not running, the agent falls back to its own prompt.
   AgentHerd never blocks an agent forever. See [ADR 0007](../adr/0007-tiered-decisions-fail-open-to-human.md).
3. A new install starts in `observe` mode. AgentHerd suggests decisions and applies none.
4. Only the owner (the person who scanned the Feishu QR code) can approve, deny or answer.
5. TypeScript everywhere. Node.js 22 or later. pnpm workspaces.
6. Docs are in English. `README.zh-CN.md` mirrors `README.md`.

## Version history

| Version | Date | Change |
| --- | --- | --- |
| 0.1.0 | 2026-11-04 | First draft |
