# ADR 0009: MIT license, reference other projects without copying code

- Status: Proposed
- Date: 2026-11-04
- Related: [docs/references.md](../references.md)

## Context

PI-Desktop is LGPL-3.0. OpenBot is PolyForm Noncommercial 1.0.0. Both are useful references
for design, UI and agent integration. Copying their code would bind AgentHerd to their
licenses.

## Decision

- AgentHerd is MIT.
- Do not copy code, styles or assets from PI-Desktop or OpenBot. Reading them to learn
  patterns is allowed; write new code from the spec.
- MIT and Apache-2.0 dependencies are fine. Any copyleft or noncommercial dependency needs
  an ADR.

## Alternatives

- Fork PI-Desktop under LGPL: faster UI, but license limits and a large unrelated codebase.

## Consequences

- Agents that write code must be told not to open those repos as a source to copy from.
