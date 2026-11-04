# ADR 0003: Build the Herder on Pi agent core

- Status: Accepted, amended by [ADR 0017](0017-resident-herder-per-project.md) and [ADR 0018](0018-one-herder-as-secretary-separate-approvals.md)
- Date: 2026-11-04
- Related: [04-herder.md](../spec/04-herder.md)

## Context

The Herder needs a small agent loop for hard cases (L2): a model with a few read-only tools,
run inside the AgentHerd process, with a strict budget. Options studied on 2026-11-04:

- Pi (`earendil-works/pi`, MIT): `@earendil-works/pi-agent-core` runs an agent in process
  (`new Agent({ initialState, streamFn })`), with hooks to change the context before each
  model call. Small (agent source about 96 KB). Many model providers.
- DeepSeek Harness (DSH, MIT): rich features (subagents, compaction, sandbox, MCP, ACP
  server), but the SDK starts a full `dsh` subprocess and talks JSON-RPC over stdio.
- Use Claude Code or Codex itself as the supervisor.

## Decision

Use Pi agent core for L2, in process. L1 uses the same provider layer with a single
structured-output call. The Herder is stateless between events.

## Alternatives

- DSH: too heavy to embed for one short read-only loop; better as a supervised agent (ACP).
- Claude Code / Codex as supervisor: slow and costly per event, the context grows with every
  event, and it ties AgentHerd to one vendor. Also blocked on some company machines.

## Consequences

- AgentHerd depends on Pi packages; their versions are pinned and upgrades are tested (Q09).
- Users can choose any model provider that Pi supports, including DeepSeek.
