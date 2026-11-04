# Plan 005: Pi's agent loop lives in packages/herder-loop and one upstream sync has been done with the sync script

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat 6aead0a..HEAD -- docs/adr/0020-fork-pi-agent-loop-track-upstream.md package.json pnpm-workspace.yaml biome.json tsconfig.base.json`.
> If files changed in a way that makes "Current state" wrong, STOP.

## Status

- Milestone: M2
- Size: M
- Risk: MEDIUM
- Depends on: [ADR 0020](../docs/adr/0020-fork-pi-agent-loop-track-upstream.md)
- Planned at: `6aead0a`, 2026-11-04

## Why this matters

The Herder ([04-herder.md](../docs/spec/04-herder.md)) runs on Pi's agent loop. ADR 0020 forks
the loop into the repo and requires that it keeps following upstream. This plan creates the
fork and proves the sync path works by doing a real sync, before any Herder code depends on it.

## Current state

- No `packages/herder-loop`. Workspace packages: protocol, rules, acp-client, mock-agent, core,
  channel-fake, channel-feishu, cli. TypeScript runs from source (`exports: ./src/index.ts`).
- Pi upstream: `https://github.com/earendil-works/pi` (MIT). Tags: `v1.4.0` = `4a08025`,
  `v1.5.0` = `f9a2636`. npm `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` both
  have `1.4.0` and `1.5.0`.
- Loop source: `packages/agent/src/{agent-loop,agent,index,proxy,stream-fn,types}.ts`; tests
  `packages/agent/test/{agent-loop,agent,e2e,proxy}.test.ts` + `test/utils/*`. It imports
  `@earendil-works/pi-ai`, `@earendil-works/pi-ai/compat` (tests) and `typebox`.
- Between `v1.4.0` and `v1.5.0` upstream changed `src/proxy.ts`, `src/types.ts` and four test
  files. This is the change used for the first sync.

## Scope

**In scope:**

- `packages/herder-loop`: upstream files at `v1.4.0` copied byte for byte, MIT notice,
  `UPSTREAM.md`, package.json pinning `@earendil-works/pi-ai` and `typebox` exactly.
- `scripts/sync-pi-loop.ts` (three-way merge per file) and its tests.
- First sync to `v1.5.0` with the script, including the `pi-ai` upgrade to `1.5.0`.

**Out of scope:**

- Any local change to the loop (none is needed yet).
- `ModelClient`, Herder tools and prompts (plan 008).

## Decisions made while planning

- **Base on a release tag, not a branch commit**, so the fork matches a published `pi-ai`.
- **Upstream files are not formatted or linted by our tools** (biome excludes
  `packages/herder-loop/src` and `packages/herder-loop/test`): reformatting would turn every
  sync into conflicts. They are type-checked with a package tsconfig that relaxes only the
  options upstream does not use (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `erasableSyntaxOnly` if needed). The relaxed options are listed in `UPSTREAM.md`.
- **Upstream tests are copied and run** in our `pnpm test`. Tests that call real providers are
  skipped by upstream when keys are missing; keep that behavior.
- Imports of `pi-ai` stay inside `packages/herder-loop` and the future `ModelClient`
  implementation (ADR 0020, decision 5).

## Commands you will need

```bash
pnpm install
pnpm check
pnpm test packages/herder-loop
node scripts/sync-pi-loop.ts --to v1.5.0 [--repo <path to pi clone>] [--dry-run]
```

## Steps

### Step 1: Create the package at v1.4.0

Copy `packages/agent/src/*.ts` and `packages/agent/test/**` from Pi `v1.4.0` into
`packages/herder-loop/src` and `packages/herder-loop/test` without changes. Add `LICENSE`
(Pi's MIT text), `package.json` (`@agentherd/herder-loop`, deps `@earendil-works/pi-ai: 1.4.0`,
`typebox` exact as upstream), `tsconfig.json`, and a vitest alias if `pi-ai/compat` needs one.

**Verify:** `diff -r <pi>/packages/agent/src packages/herder-loop/src` (at `v1.4.0`) → no output;
`pnpm --filter @agentherd/herder-loop typecheck` → exit 0; `pnpm test packages/herder-loop` → pass.

### Step 2: UPSTREAM.md

Record: upstream repo, path mapping (`packages/agent/src` → `src`, `packages/agent/test` →
`test`), base tag and commit, pinned `pi-ai`, relaxed tsconfig options, a table of local
changes (empty), a table of skipped upstream changes (empty), and the sync procedure. The base
line has a fixed format the script reads and writes:
`Base: v1.4.0 (4a08025…full sha)`.

**Verify:** `grep '^Base:' packages/herder-loop/UPSTREAM.md` → one line with the full sha.

### Step 3: Sync script

`scripts/sync-pi-loop.ts`:

1. Find the Pi clone: `--repo`, else `PI_REPO`, else clone into `~/.cache/agentherd/pi`
   (`git fetch --tags` if it exists).
2. Read base from `UPSTREAM.md`; resolve `--to` (tag or sha).
3. For each file under the mapped paths in base or target:
   - unchanged upstream → skip;
   - changed upstream, fork file equal to base → write target;
   - changed upstream and locally → `git merge-file` (fork, base, target); conflicts leave
     markers and are reported;
   - added upstream → copy (conflict if a local file exists with other content);
   - deleted upstream → delete if fork equals base, else report conflict.
4. If target `packages/agent/package.json` pins another `pi-ai` or `typebox` version, update
   ours and report it.
5. Update the `Base:` line only when there are no conflicts. `--dry-run` only reports.
6. Print a summary: updated, merged, conflicted, added, deleted, dependency changes.

Exit codes: 0 clean, 1 conflicts, 2 usage or git errors. Pure logic (classifying files,
rewriting the base line) is in testable functions.

**Verify:** `pnpm test scripts` → pass (tests use temporary git repos: clean update, local
edit merged, conflict, add, delete).

### Step 4: First sync

Run `node scripts/sync-pi-loop.ts --to v1.5.0`, `pnpm install`, `pnpm check`, `pnpm test`.
Commit as `chore(herder-loop): sync Pi agent loop to v1.5.0 (f9a2636)`.

**Verify:** `diff -r <pi at v1.5.0>/packages/agent/src packages/herder-loop/src` → no output;
`grep '"@earendil-works/pi-ai"' packages/herder-loop/package.json` → `1.5.0`.

## Test plan

- Upstream loop tests run inside the package.
- `scripts/test/sync-pi-loop.test.ts`: classification and merge cases listed in step 3.

## Done criteria

- [x] `packages/herder-loop` equals upstream `v1.5.0` loop files; `UPSTREAM.md` base is `v1.5.0`
- [x] Sync script and its tests committed
- [x] `pnpm check` and `pnpm test` pass
- [x] ADR 0020 decision 5 wording matches where `pi-ai` is imported
- [x] `plans/README.md` state updated

## STOP conditions

- Upstream loop source does not type-check without editing upstream files.
- Upstream tests need network or keys and are not skipped without them.
- A check fails twice after a fix attempt.

## Maintenance notes

- Done 2026-11-04. Commits: `c586415` (fork at v1.4.0), `5128104` (sync script),
  `0b6a679` (script fix), `6bf720f` (first sync to v1.5.0).
- The first sync found a real change: upstream v1.5.0 replaced `typebox` with
  `@earendil-works/pi-schema`. The script first synced only a fixed list of two packages and
  missed it (typecheck failed). Fix: the fork's `dependencies` now mirror upstream's exactly.
- No tsconfig option other than `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`
  had to be relaxed. Upstream tests (92 at v1.4.0) run offline with a fake stream function.
- `pnpm-workspace.yaml` sets `allowBuilds: "@google/genai": false` (a `pi-ai` dependency; its
  install script is not needed).
- Root `pnpm check` now also type-checks `scripts/` (`tsc --noEmit -p scripts`), and vitest
  includes `scripts/test`.
