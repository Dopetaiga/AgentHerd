# Plan 003: A mock agent's permission request reaches the owner and the answer goes back

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat <plan 002 done sha>..HEAD -- packages docs/spec/04-herder.md docs/spec/05-channels.md`.
> If files changed in a way that makes "Current state" wrong, STOP.

## Status

- Milestone: M1
- Size: L
- Risk: MEDIUM
- Depends on: plans 001, 002; answers open question Q08 for the CLI
- Planned at: `c9f52e2`, 2026-11-04

## Why this matters

This is the product loop without a model and without a real chat app: an agent asks, the
guard list and rules run, the item goes to the owner through a channel, the owner's tap goes
back to the agent, and everything is recorded. It implements
[02-architecture.md §1](../docs/spec/02-architecture.md#1-layers) steps 1–6 and the M1 E2E
scenarios in [07-delivery.md §4](../docs/spec/07-delivery.md#4-e2e-scenarios).

## Current state

- `@agentherd/protocol`, `@agentherd/rules` (plan 001); `@agentherd/acp-client`,
  `@agentherd/mock-agent` (plan 002).
- `node:sqlite` (`DatabaseSync`) works on Node 26.7.0 without a flag (checked 2026-11-04). It
  is available without a flag from Node 22.13.

## Scope

**In scope:**

- `packages/core`: store, session registry, inbox, decision pipeline (guard list → rules →
  escalate), reminders, owner check, audit log, `Herd` facade.
- `packages/channel-fake`: in-memory channel for tests.
- E2E tests: E2E-APPROVE, E2E-OWNER-ONLY, E2E-DUPLICATE-ACTION, E2E-REMIND.

**Out of scope:**

- The Herder (M2) and the Reviewer (M3). In M1, an item that no rule decides is
  escalated with `source: "human"` once the owner answers.
- "Always do this" (M3). Cards offer Allow and Deny only.
- Local API socket, desktop app, exporters.

## Commands you will need

```bash
pnpm --filter @agentherd/core test
pnpm test
pnpm check
```

## Steps

### Step 1: Store

`packages/core/src/store.ts` on `node:sqlite` `DatabaseSync`, file `<home>/herd.db`
(`home` = `AGENTHERD_HOME` or `~/.agentherd`; directory mode `700`). Tests use `:memory:`.

Tables (with a `schema_version` table, version 1):

| Table | Columns |
| --- | --- |
| `sessions` | `id`, `profile_id`, `cwd`, `state`, `created_at`, `updated_at` |
| `items` | `id`, `session_id`, `kind`, `state`, `tool_call_json`, `title`, `body`, `risk`, `created_at`, `decided_at`, `message_ref_json` |
| `decisions` | `item_id`, `action`, `source`, `reason`, `confidence`, `risk`, `rule_id`, `owner_id`, `created_at` |
| `rules` | `id`, `action`, `match_json`, `created_by`, `created_at` |
| `audit` | `id`, `at`, `kind`, `data_json` |

Every text written to `items`, `decisions` and `audit` passes through `redact`.

Record in [open-questions.md](../docs/spec/open-questions.md) Q08: "CLI and tests use
`node:sqlite`; Electron `utilityProcess` to be checked in M2".

**Verify:** unit test writes and reads each table → passes.

### Step 2: Session registry

`packages/core/src/registry.ts`: keeps live sessions (`SessionState` from protocol), updates
state from `acp-client` events: `starting` on spawn, `working` on prompt and updates,
`waiting-approval` while a permission request is open, `idle` on end of turn, `error` on
agent exit with a non-zero code, `ended` on close. Every change is stored and emitted.

### Step 3: Decision pipeline (M1 subset)

`packages/core/src/pipeline.ts`: `decide(item, ctx): Decision` per
[04-herder.md §3](../docs/spec/04-herder.md#3-approval-pipeline):

1. `guardCheck` hit → `{ action: "escalate", risk: "high", source: "rule", reason: <guard reason> }`.
2. `matchRules` hit → `{ action: rule.action, confidence: 1, risk: "low", source: "rule" }`.
3. Otherwise → `{ action: "escalate", risk: "medium", source: "rule", reason: "no rule matched" }`.

Apply by mode ([04-herder.md §4](../docs/spec/04-herder.md#4-modes)):

- `observe`: store the decision as a suggestion; always escalate to the owner.
- `assist` / `auto`: apply a rule `allow`/`deny` directly; escalate the rest.
- Any exception in the pipeline → escalate (never allow). Unit test this.

### Step 4: Inbox and channel binding

`packages/core/src/inbox.ts`:

- `ItemView` rendering (title from tool call title, body = command + paths, at most 20 lines,
  redacted; options Allow / Deny; reason; risk).
- At most one open card per session; newer items for the same session queue and are sent
  when the previous one closes ([05-channels.md §2](../docs/spec/05-channels.md#2-what-the-owner-sees)).
- Inbound handling:
  - `from !== binding.ownerId` → drop, write audit `inbound.dropped` with reason `not-owner`.
  - action for an unknown or closed item → drop, audit `inbound.dropped` with reason
    `not-open` (this gives duplicate taps their "applied once" behavior).
  - otherwise → `Decision { source: "human" }`, respond to the agent, `updateItem` with the
    final state, store.
- Reminders: every `remindMinutes` (default 30) for each open item, send a reminder text.
  Never decide because time passed. Use an injectable clock (`setTimeout`-like interface) so
  tests do not wait.
- Agent gone (exit or cancel) while an item is open → item state `expired`, card updated.

### Step 5: `Herd` facade

`packages/core/src/herd.ts`: composes store, registry, pipeline, inbox and one channel:

```ts
class Herd {
  constructor(opts: { home: string; channel: Channel; binding: ChannelBinding; mode: Mode; profiles: AgentProfile[]; clock?: Clock; remindMinutes?: number });
  start(): Promise<void>;
  run(profileId: string, cwd: string, prompt: string): Promise<{ sessionId: string; stopReason: string }>;
  stop(): Promise<void>;
}
```

`core` imports no Electron and no channel package; it receives a `Channel`.

### Step 6: `packages/channel-fake`

Implements `Channel` in memory: records every `sendItem`, `updateItem`, `sendText`; exposes
`tap(itemId, action, from)` and `say(text, from)` that call the inbound sink; capabilities
`["buttons", "free-text", "update-message"]`.

### Step 7: E2E tests

`packages/core/test/e2e/*.test.ts`, each running `Herd` with `channel-fake` and the real
`mock-agent` process:

| Scenario | Checks |
| --- | --- |
| E2E-APPROVE | one card sent; owner taps Allow; agent's `expect: allow_once` holds; turn ends `end_turn`; card updated to "Allowed by you"; decision row with `source = human` |
| E2E-OWNER-ONLY | a non-owner tap changes nothing; agent still waiting; audit row `inbound.dropped`/`not-owner`; owner tap then works |
| E2E-DUPLICATE-ACTION | two owner taps; agent receives one answer; one decision row; second tap audited `not-open` |
| E2E-REMIND | fake clock advanced by `remindMinutes`; one reminder sent; item still open; nothing decided |

Plus a unit-level test: guard-listed command (`git push --force`) is escalated with risk
`high` even when an `allow` rule matches it, in `assist` mode.

**Verify:** `pnpm test` → all pass; `pnpm check` → exits 0.

### Step 8: Docs and commit

- Mark E2E-APPROVE, E2E-OWNER-ONLY, E2E-DUPLICATE-ACTION, E2E-REMIND as implemented
  (add the test file path in a new column "Test" in [07-delivery.md §4](../docs/spec/07-delivery.md#4-e2e-scenarios)).
- Update Q08.
- Commits: `feat(core): …` and `test(core): …` with why-bodies.

## Test plan

E2E scenarios above, unit tests for store, pipeline (including the exception → escalate
case) and ItemView rendering (redaction, 20-line cap).

## Done criteria

- [ ] All four M1 scenarios pass with the real mock-agent process.
- [ ] No path from an error to `allow` (reviewed and unit tested).
- [ ] `core` has no Electron or channel-package imports.
- [ ] Q08 and the E2E table updated; `plans/README.md` state set to `DONE`.

## STOP conditions

- The pipeline needs a field that `@agentherd/protocol` does not have (a contract change;
  AGENTS.md rule 7).
- A check fails twice after a fix attempt.

## Maintenance notes

- `source: "rule"` is used for guard escalations in M1 because `Decision.source` has no
  `guard` value. If M3 needs to tell them apart, add `guard` through a protocol change.
- Deviations from the steps, found while implementing:
  - The protocol `Channel` has `send`/`update`/`pin` with a `View`, not `sendItem`/`updateItem`/
    `sendText`. The inbox sends an `ItemView`, then updates it with `options: []` and `final`.
  - Text messages from the owner are only audited (`inbound.ignored`) in M1: there is no Herder.
  - `FakeChannel.waitFor` resolves after `send` returns, as a real channel would. The inbox
    accepts a tap only for a card whose `send` has returned.
  - AgentHerd keeps its own session ids (`randomUUID`); the agent's id is used only on the wire.
  - When the agent's turn ends, its open items expire (`Expired: the agent's turn ended`).

