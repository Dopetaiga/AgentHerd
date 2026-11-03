# ADR 0010: TypeScript pnpm monorepo

- Status: Proposed
- Date: 2026-11-04
- Related: [02-architecture.md](../spec/02-architecture.md#3-packages)

## Context

Desktop app, core, hook bridge, adapters and channels share types and must change together.

## Decision

- One repo, pnpm workspaces, TypeScript in strict mode, ES modules.
- Node.js 22 or later.
- Biome for lint and format. Vitest for unit and E2E tests.
- Package names `@agentherd/<name>`.

## Alternatives

- Separate repos per adapter: version skew between protocol and adapters.
- npm or Bun workspaces: pnpm has the strictest dependency isolation and is what the
  maintainer uses daily.

## Consequences

- `packages/protocol` is the contract; changing it needs the spec and all adapters updated
  in the same change.
