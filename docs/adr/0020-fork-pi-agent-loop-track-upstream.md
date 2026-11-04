# ADR 0020: Fork Pi's agent loop into the repo and follow its upstream; use pi-ai pinned behind ModelClient

- Status: Accepted
- Date: 2026-11-04
- Related: [ADR 0003](0003-herder-on-pi-agent-core.md), [ADR 0018](0018-one-herder-as-secretary-separate-approvals.md), [04-herder.md](../spec/04-herder.md), Q09 in [open-questions.md](../spec/open-questions.md)

## Context

ADR 0003 puts the Herder on Pi. The maintainer does not want AgentHerd to depend fully on Pi
packages and their release pace, and also wants AgentHerd to keep following improvements to
Pi's agent loop.

Facts, checked on 2026-11-04:

- Pi (`earendil-works/pi`, MIT) local checkout at commit `6c384aa` (2026-10-26).
  `packages/agent/src` (the agent loop, `@earendil-works/pi-agent-core`) is 2,541 lines without
  tests and depends only on `@earendil-works/pi-ai` and `typebox`.
  `packages/ai/src` (provider adapters, `@earendil-works/pi-ai`) is 28,504 lines and depends on
  the Anthropic, OpenAI, Google GenAI and AWS Bedrock SDKs.
- PI-Desktop depends on the npm packages pinned to `1.4.0` and changes them with
  `pnpm patchedDependencies`: 3 patches, 2,029 lines, written against the compiled `dist/`
  files (1,498 lines for `pi-ai`). Each Pi upgrade (1.0 → 1.1 → 1.3 → 1.4) was a separate
  migration commit followed by fixes. Its ADR 0002 accepts "adapting to pi's events and
  version constraints" as the cost of keeping pace with upstream.
- New models and provider API changes land in `pi-ai`. The agent loop changes less often.

## Decision

1. **The agent loop is forked into the repo** as `packages/herder-loop`, copied from Pi's
   `packages/agent/src` (MIT notice kept). AgentHerd owns it and changes it freely.
2. **The fork follows upstream.** `packages/herder-loop/UPSTREAM.md` records the upstream
   repository, the base commit and every local change with its reason. A sync script
   (`scripts/sync-pi-loop.ts`) checks out the new upstream commit, computes the upstream diff
   from the recorded base, and applies it to the fork with a three-way merge
   (`git merge-file` per file). Conflicts are resolved by hand. A sync is one commit,
   `chore(herder-loop): sync Pi agent loop to <sha>`, that updates `UPSTREAM.md` and passes
   `pnpm check` and `pnpm test`.
3. **Local changes stay small and separate** so syncs stay cheap: prefer new files and the
   loop's own hooks (`beforeToolCall`, `afterToolCall`, `transformContext`, …) over edits to
   upstream files; every edit to an upstream file is listed in `UPSTREAM.md`.
4. **When to sync:** a check runs at the start of each milestone and when Pi releases a
   version whose changelog touches the agent loop. Skipping an upstream change is allowed and
   is recorded in `UPSTREAM.md` with the reason.
5. **Providers come from `@earendil-works/pi-ai`, pinned to an exact version**, and only
   through AgentHerd's own `ModelClient` interface. Only `packages/herder-loop` (upstream code)
   and the `ModelClient` implementation import `pi-ai`. AgentHerd
   does not patch `pi-ai`; behavior changes go into the `ModelClient` implementation.
   The version is the one upstream's loop pins; the sync script keeps the fork's dependencies
   equal to upstream's. Upgrading `pi-ai` otherwise is a deliberate commit. If `pi-ai` stops fitting, another implementation
   of `ModelClient` (for example OpenAI-compatible HTTP) replaces it.

## Alternatives

- **Depend on `pi-agent-core` from npm and patch it (PI-Desktop's way):** rejected. Patches on
  compiled files break on every release, and the release pace of Pi decides when AgentHerd
  must migrate.
- **Fork the whole Pi repository:** rejected. Maintaining 28,000 lines of provider adapters and
  their SDK upgrades is not AgentHerd's work, and merges would cover far more than the loop.
- **Fork the loop and stop following upstream:** rejected by the maintainer. Pi's loop gets
  fixes and features (steering, retries, tool execution) that AgentHerd wants.
- **Use DSH as the Herder:** rejected (2026-11-04). It runs as a separate full harness process,
  ships its own write and shell tools that would all have to be turned off, needs DSH installed
  by every user, and DSH is itself one of the agents AgentHerd manages.

## Consequences

- AgentHerd can change the loop without waiting for Pi, and the loop does not change under it
  when Pi releases.
- Each sync is real work: the more local edits, the more conflicts. `UPSTREAM.md` keeps the
  list short and visible.
- The fork's types must stay compatible with the pinned `pi-ai` version; a sync that needs a
  newer `pi-ai` upgrades it in the same commit.
- Q09 is answered by this ADR.
