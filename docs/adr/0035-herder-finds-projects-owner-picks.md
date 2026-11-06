# ADR 0035: The Herder finds projects; the owner always picks

- Status: Accepted
- Date: 2026-11-06

## Context

The owner once picked `/tmp/demo` from a button. The Herder then started later tasks for other
projects there, calling it "the agreed folder". The folder came from its session history and
`recentProjects()`; there was no memory yet.

## Decision

- New tool `project_find(name)`: git repositories under the home folder whose folder name matches
  (case, `-`, `_`, spaces ignored), exact first, then similar names.
- The Herder always asks with buttons (≤3 paths + 「其他」), even for one match. No match and
  nothing similar: it says so, no buttons.
- `session_start` rejects a `cwd` the owner did not type or pick in the current turn.
- Every `ask` gets 「其他」 appended by code.

## Consequences

- One more button press for the common case, in exchange for never running in a guessed folder.
- See [spec 08 §1](../spec/08-herder-interaction.md#1-finding-the-project).
