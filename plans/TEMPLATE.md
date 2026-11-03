# Plan NNN: <outcome sentence>

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat <planned-at-sha>..HEAD -- <paths this plan reads>`.
> If files changed in a way that makes "Current state" wrong, STOP.

## Status

- Milestone: M?
- Size: S | M | L
- Risk: LOW | MEDIUM | HIGH
- Depends on: plan NNN, open question Q??
- Planned at: `<sha>`, YYYY-MM-DD

## Why this matters

<One paragraph: the user-visible result and the spec section it implements.>

## Current state

<What exists now, with paths and short code excerpts.>

## Scope

**In scope:**

- ...

**Out of scope:**

- ...

## Commands you will need

```bash
pnpm install
pnpm check
pnpm test --filter <package>
```

## Steps

### Step 1: <title>

<What to do, which files, which spec section.>

**Verify:** `<command>` → <expected result>

## Test plan

<E2E scenario IDs and unit tests to add.>

## Done criteria

- [ ] ...
- [ ] Spec, ADR index, E2E table updated if behavior changed
- [ ] `plans/README.md` state updated

## STOP conditions

- A fact in the spec turns out to be wrong (record it in `docs/spec/open-questions.md`).
- A step needs a change to `packages/protocol` that the plan does not describe.
- A check fails twice after a fix attempt.

## Maintenance notes

<What a later reader must know: shortcuts taken, follow-up work.>
