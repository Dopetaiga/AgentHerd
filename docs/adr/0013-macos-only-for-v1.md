# ADR 0013: macOS only for v1

- Status: Proposed
- Date: 2026-11-04
- Related: [00-baseline.md](../spec/00-baseline.md)

## Context

The maintainer and the first users use Macs. Keep-awake (ADR 0011), agent config paths and the
local socket differ per operating system.

## Decision

- v1 supports macOS 14 or later on Apple Silicon and Intel.
- Code stays portable where it is free (paths through one helper, no shell-specific syntax),
  but Windows and Linux are not built or tested.
- The macOS build is not signed or notarized until M5.

## Alternatives

- macOS and Linux: about 30% more work for desktop, tray and packaging.
- All three: Windows named pipes and paths need separate work.

## Consequences

- Early users open the app with right-click → Open the first time.
