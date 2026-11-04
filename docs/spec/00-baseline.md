# 00. Baseline

- Baseline version: 0.2.0
- Status: Frozen on 2026-11-04 (version 0.2.0). Approved by the maintainer.
- Date: 2026-11-04

## What the baseline is

The baseline is the set of specs and ADRs that the first implementation follows. When the
baseline is frozen, a change to a frozen decision needs a new ADR and a baseline version bump.

## Contents

| Doc | Topic |
| --- | --- |
| [01-product.md](01-product.md) | Problem, users, goals, non-goals, success metrics |
| [02-architecture.md](02-architecture.md) | Processes, packages, data flow, local API |
| [03-agents.md](03-agents.md) | ACP runtime and rule export to agents' own configs |
| [04-herder.md](04-herder.md) | The Herder (secretary), following tasks, the approval pipeline, modes |
| [05-channels.md](05-channels.md) | How AgentHerd reaches the user; Feishu is the first channel |
| [06-security.md](06-security.md) | Trust boundaries, secrets, failure behavior |
| [07-delivery.md](07-delivery.md) | Milestones, testing, acceptance criteria |
| [glossary.md](glossary.md) | Terms used in code, UI and docs |
| [open-questions.md](open-questions.md) | Questions that block or shape later work |

Accepted decisions are in [../adr/README.md](../adr/README.md).

## Frozen defaults (0.2.0)

These defaults hold until an ADR changes them.

1. The Herder runs on the user's machine. AgentHerd has no server of its own.
2. When AgentHerd cannot decide, it asks the owner. It never answers "allow" because of an
   error. See [ADR 0007](../adr/0007-tiered-decisions-fail-open-to-human.md).
3. A new install starts in `observe` mode. AgentHerd suggests decisions and applies none.
4. Only the owner (the person who scanned the Feishu QR code) can approve, deny or answer.
5. TypeScript everywhere. Node.js 22 or later. pnpm workspaces.
6. Docs are in English. `README.zh-CN.md` mirrors `README.md`.
7. macOS 14 or later only ([ADR 0013](../adr/0013-macos-only-for-v1.md)).
8. Every escalated item goes to the channel; the desktop app manages, it does not decide
   ([ADR 0012](../adr/0012-channel-is-the-only-decision-surface.md)).
9. Models are chosen by the user during onboarding; no default provider. One Herder for all
   projects on a light model; it never approves. Approvals use guard list → rules → Reviewer
   (strongest model, per item) → owner ([ADR 0018](../adr/0018-one-herder-as-secretary-separate-approvals.md)).
10. ACP is the only runtime protocol to agents; terminal sessions get exported rules
    ([ADR 0015](../adr/0015-acp-is-the-only-runtime-protocol.md), [ADR 0016](../adr/0016-one-rule-source-exported-to-agents.md)).
11. The owner's and the agents' words pass verbatim; the Herder only adds labeled context.
    Progress is a pinned board; every finished task sends a report, summarized by the agent
    itself when its reply is long; nothing agents say to the owner is filtered or shortened ([ADR 0019](../adr/0019-relay-verbatim-board-and-reports.md)).

## Version history

| Version | Date | Change |
| --- | --- | --- |
| 0.2.0 | 2026-11-04 | One Herder as secretary on a light model, separate approval pipeline with Reviewer, relay, verbatim rule, board and reports (ADR 0018, 0019) |
| 0.1.0 | 2026-11-04 | Frozen. Maintainer decisions on platform, decision surface, ACP-only runtime, rule export, resident Herder, model, rule scope, signing |
