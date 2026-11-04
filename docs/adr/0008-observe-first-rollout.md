# ADR 0008: Observe-first rollout

- Status: Accepted
- Date: 2026-11-04
- Related: [04-herder.md](../spec/04-herder.md#4-modes)

## Context

Users will not let a new tool approve shell commands on day one, and they should not. The
dsh-superagent prototype uses an observe mode for the same reason.

## Decision

- Modes `observe` (apply nothing, record suggestions), `assist` (apply rules only), `auto`
  (apply rules and confident low-risk model decisions).
- New installs start in `observe`.
- The desktop app shows the agreement rate between suggestions and the owner's real answers
  next to the mode switch.
- Where human decisions go is separate from mode. (The presence state first described here
  was removed by ADR 0012.)

## Alternatives

- Start in `auto` with a strict guard list: faster value, but one bad decision ends trust.

## Consequences

- AgentHerd gives value in `observe` mode through remote answers and notifications, before
  any automatic decision.
