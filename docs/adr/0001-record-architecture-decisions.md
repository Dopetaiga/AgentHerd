# ADR 0001: Record architecture decisions

- Status: Accepted
- Date: 2026-11-04
- Related: [docs/README.md](../README.md)

## Context

AgentHerd starts as a design before code, and much of the code will be written by coding
agents that follow plans. Agents and future contributors need to know why the design is the
way it is, not only what it is.

## Decision

- Record each decision that is hard to reverse, crosses package boundaries, or picks one of
  several reasonable options, as an ADR in `docs/adr/`.
- File name: `NNNN-slug.md`. Take the next free number when the ADR is merged to `main`.
- Format: title line `# ADR NNNN: <title>`, then `Status`, `Date`, `Related`, then the
  sections `Context`, `Decision`, `Alternatives`, `Consequences`.
- Status values: `Proposed`, `Accepted`, `Superseded by NNNN`, `Rejected`.
- An accepted ADR is not edited except for its status line and links. A changed decision is
  a new ADR that supersedes the old one.
- An ADR explains a decision. The behavior itself is specified in `docs/spec/`, and the code
  and tests are the final source of truth.

## Alternatives

- Only a decisions table (one line per decision). Too short to keep the reasons and the
  rejected options.
- No ADRs, only plans (OpenBot style). Plans record how to build something, not why.

## Consequences

- Each ADR costs a few minutes. Spec pages link to the ADRs they apply.
- `docs/adr/README.md` keeps an index table that must list every ADR.
