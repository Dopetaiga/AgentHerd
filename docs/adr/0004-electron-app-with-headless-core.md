# ADR 0004: Electron desktop app with a headless core

- Status: Proposed
- Date: 2026-11-04
- Related: [02-architecture.md](../spec/02-architecture.md)

## Context

AgentHerd needs a desktop window for onboarding (QR code), session overview, rules and
history, plus a tray icon to stay running. The core logic (ACP client, Herder, channels) is
Node code, and both the Pi packages and the Feishu SDK are Node packages. The maintainer
knows Electron + React from AgentRecall and PI-Desktop.

## Decision

- Electron with electron-vite, React, TypeScript, Tailwind CSS and zustand.
- The core runs in an Electron `utilityProcess` and contains no Electron imports, so it can
  run as a plain Node process for tests and a later headless mode.
- The UI follows the look of PI-Desktop. No code is copied from PI-Desktop (see ADR 0009).

## Alternatives

- Tauri: smaller binary, but the core would run as a Node sidecar anyway, which adds a
  second runtime and IPC hop.
- CLI only: fails the "set up in 5 minutes" goal for most users and has no good place for
  the QR code and history.

## Consequences

- Larger download (about 100 MB). Acceptable for a desktop tool.
- Main process stays thin; business logic is testable without Electron.
