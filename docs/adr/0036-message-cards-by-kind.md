# ADR 0036: Each kind of message has its own card

- Status: Accepted
- Date: 2026-11-06

## Context

Herder text, task reports and approvals looked alike in Feishu; the owner had to read a message to
know which it was. Relayed replies were long (550 chars passed the 600-char limit untouched) and
the length hint went only with a task's first prompt.

## Decision

- Herder talk is plain text. Herder questions, task reports (done / running / failed) and approvals
  are cards with their own colour and title (purple, green / blue / red, orange). The app uses the
  same titles and colours.
- Every prompt to an agent carries the length hint. Report bodies are ≤400 chars, summarized by the
  fast model when longer; the full reply is folded under 「完整回复」.

## Consequences

- See [spec 08 §3–4](../spec/08-herder-interaction.md#3-who-is-speaking).
