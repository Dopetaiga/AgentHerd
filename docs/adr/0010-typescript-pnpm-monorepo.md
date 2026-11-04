# ADR 0010: TypeScript pnpm monorepo

- Status: Accepted
- Date: 2026-11-04
- Related: [02-architecture.md](../spec/02-architecture.md#3-packages)

## Context

Desktop app, core, ACP client, exporters and channels share types and must change together.

## Decision

- One repo, pnpm workspaces, TypeScript in strict mode, ES modules.
- Node.js 22 or later.
- Biome for lint and format. Vitest for unit and E2E tests.
- Package names `@agentherd/<name>`.

## Alternatives

- Separate repos per exporter or channel: version skew with the protocol.
- npm or Bun workspaces: pnpm has the strictest dependency isolation and is what the
  maintainer uses daily.

## Consequences

- `packages/protocol` is the contract; changing it needs the spec, ACP client, exporters and channels updated
  in the same change.
