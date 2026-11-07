# Upstream: billion-context's acp-kernel

This package is a copy of `kernel/` from [billion-context](https://github.com/ranxianglei/billion-context)
(`acp-kernel` 0.0.185, MIT with an attribution term, see [LICENSE](LICENSE)). AgentHerd owns the
copy: it is not an npm dependency, and we change it when the Herder needs it
([ADR 0041](../../docs/adr/0041-herder-context-folded-by-the-model.md)). The Herder uses it through
`packages/herder/src/context.ts`.

Base: master (6945a354d4565602007f0c0ae8607b035110afc7), 2026-11-07

## Path mapping

| Upstream | Here |
| --- | --- |
| `kernel/src/` | `src/` |
| `kernel/tests/` | `tests/` |
| `kernel/README.md`, `DESIGN.md`, `DESIGN-prompts.md`, `PROVENANCE.md`, `SECURITY.md`, `LICENSE` | same names |

Not copied: `bench/`, `scripts/`, `tsup.config.ts`, `package-lock.json`, the upstream
`package.json` and `tsconfig.json`.

## Differences from upstream that are not code

- `package.json` is ours: `@agentherd/context-kernel`, private, no build. The exports point at
  the `.ts` sources, which Node and Vitest run directly. Upstream has only dev dependencies, so
  there are none here.
- `tsconfig.json` type-checks `src/` (as upstream does) and our `test/`, not `tests/`. It turns
  off `exactOptionalPropertyTypes` and adds `ES2024.Promise` (`Promise.withResolvers`).
- `src/` and `tests/` are excluded from biome so files stay comparable with upstream.
- `test/kernel-suite.test.ts` runs the upstream `node:test` suite (`tests/`) inside `pnpm test`.

## Local changes to upstream files

Every edit to a file under `src/` or `tests/` is listed here, with the reason.

| File | Change | Reason | Since |
| --- | --- | --- | --- |
| all `src/`, `tests/` files (210) | Relative import specifiers end in `.ts` instead of `.js` | The sources run without a build step (`allowImportingTsExtensions`) | 2026-11-07 |
| `src/wire/bili-message.ts` | `import type { CoreMessage } from "../types.ts"` instead of `"acp-kernel"` | The package is not installed under its upstream name | 2026-11-07 |

## Taking an upstream fix

There is no sync script. To take a fix by hand:

1. Download upstream at the new commit:
   `gh api repos/ranxianglei/billion-context/tarball/<sha> > kernel.tgz` and unpack `kernel/`.
2. In the unpacked `src/` and `tests/`, rewrite relative imports from `.js` to `.ts` and fix
   `src/wire/bili-message.ts` as listed above.
3. Three-way merge each changed file (ours, upstream at `Base`, upstream at the new commit), for
   example with `git merge-file`, and copy new files.
4. Update the `Base:` line and the tables above, then run
   `pnpm --filter @agentherd/context-kernel typecheck && pnpm test`.

Commit one sync as `chore(context-kernel): sync acp-kernel to <short sha>`.
