# Upstream: Pi agent loop

This package is a fork of the agent loop of [Pi](https://github.com/earendil-works/pi)
(`@earendil-works/pi-agent-core`, MIT, see [LICENSE](LICENSE)). AgentHerd owns it and keeps
following upstream ([ADR 0020](../../docs/adr/0020-fork-pi-agent-loop-track-upstream.md)).

Base: v1.5.0 (f9a26365568127461c47a07a37dcb42c140a3ac5)

## Path mapping

| Upstream | Here |
| --- | --- |
| `packages/agent/src/` | `src/` |
| `packages/agent/test/` | `test/` |

`dependencies` in `package.json` are exactly the ones in upstream `packages/agent/package.json`
(the sync script adds, changes and removes entries). The fork has no dependencies of its own.

## Differences from upstream that are not code

- `src/` and `test/` are excluded from biome so files stay byte for byte comparable.
- `tsconfig.json` turns off `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`,
  which upstream does not use. All other options are the repo defaults.

## Local changes to upstream files

Every edit to a file under `src/` or `test/` is listed here, with the reason. Keep this list
short: prefer the loop's hooks and new code in other packages.

| File | Change | Reason | Since |
| --- | --- | --- | --- |
| — | — | — | — |

## Skipped upstream changes

| Upstream commit | File | Reason |
| --- | --- | --- |
| — | — | — |

## How to sync

```bash
node scripts/sync-pi-loop.ts --to <tag or sha> [--repo <pi clone>] [--dry-run]
pnpm install && pnpm check && pnpm test
```

The script three-way merges each mapped file (fork, upstream at base, upstream at target),
updates the dependency versions and, if there are no conflicts, the `Base:` line. Resolve
conflicts by hand, then set the `Base:` line yourself. Commit one sync as
`chore(herder-loop): sync Pi agent loop to <tag> (<short sha>)`.

Check for a sync at the start of each milestone and when a Pi release changes the loop.
