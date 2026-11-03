# ADR 0012: The channel is the only place where the owner decides

- Status: Proposed
- Date: 2026-11-04
- Related: [04-herder.md](../spec/04-herder.md#3-where-human-decisions-go), [ADR 0008](0008-observe-first-rollout.md)

## Context

The first draft had a "presence" state (`desk` or `away`). At the desk, items stayed in the
agent's terminal; away, they went to the chat app. The maintainer decided on 2026-11-04 that
the desktop app is only for management, and that every decision goes to the chat app.

## Decision

- Remove presence. Every escalated item goes to the channel.
- An open item waits for the owner and gets a reminder every `remindMinutes` (default 30).
  No timeout ever decides for the owner.
- If the channel is disconnected, items wait in the inbox until it reconnects.
- The desktop app shows items read-only and links to them; it has no allow/deny buttons in v1.

## Alternatives

- Presence with idle or lid detection: fewer chat messages at the desk, but more states, more
  guessing, and the owner must think about where to look.
- Timeout falls back to the terminal or auto-denies: the agent may wait in a terminal no one
  watches, or take a detour the owner did not want.

## Consequences

- One place to look, the same on desk and phone.
- At the desk, an agent waits for a chat answer even if the terminal is in front of the owner.
- Supersedes the presence part of ADR 0008.
