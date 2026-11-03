# ADR 0002: English docs with a Chinese README mirror

- Status: Proposed
- Date: 2026-11-04
- Related: [ADR 0001](0001-record-architecture-decisions.md)

## Context

The maintainer writes Chinese best. The goal is an open-source project with a wide audience.
PI-Desktop wrote its first ADRs in Chinese and translated all of them to English on the
same day.

## Decision

- Code, comments, identifiers, commit messages, specs, ADRs and plans are in English.
- Use short sentences and common words (in the spirit of ASD-STE100 Simplified Technical
  English), so machine translation and non-native readers work well.
- `README.md` is the source. `README.zh-CN.md` mirrors it and is updated in the same commit.
- Product UI text is localizable from the start (English and Simplified Chinese).

## Alternatives

- Chinese first. Faster for the maintainer now, but it limits contributors and costs a full
  translation later.
- Full bilingual docs. Doubles the maintenance of every spec.

## Consequences

- The maintainer reviews docs in English. Agents can translate on request.
