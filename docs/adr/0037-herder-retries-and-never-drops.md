# ADR 0037: The Herder retries, switches model, and never drops a message

- Status: Accepted
- Date: 2026-11-06

## Context

On 2026-11-05 21:31 an owner message hit "Connection error." in the Herder. It was not retried and
the owner was not told.

## Decision

- Transient errors (network, timeout, 429, 5xx) retry after 2 s, 10 s, 30 s.
- Then the Herder runs on the next model by tier and tells the owner in a red card.
- If every model fails, the message stays queued and the owner gets a red card with 「重试」.
- Auth, balance and bad-request errors are not retried; the card says what to change.

## Consequences

- See [spec 08 §5](../spec/08-herder-interaction.md#5-errors).
