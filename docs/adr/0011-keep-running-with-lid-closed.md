# ADR 0011: Keep running with the lid closed (macOS)

- Status: Accepted
- Date: 2026-11-04
- Related: [02-architecture.md](../spec/02-architecture.md#7-keep-running-with-the-lid-closed), [ADR 0004](0004-electron-app-with-headless-core.md)

## Context

The maintainer wants AgentHerd to keep working when the laptop lid is closed, for example
while walking to a meeting. On macOS, closing the lid puts the system to sleep. Agents stop,
and the Feishu long connection drops. `caffeinate` and power assertions only stop idle
sleep, not lid-close sleep. Built-in clamshell mode needs an external display and power.

Two options were discussed on 2026-11-04:

- A: keep this Mac awake with the lid closed.
- B: run the core and agents on another always-on machine.

## Decision

- Do A. Add an opt-in "Keep running with the lid closed" switch in the desktop app.
- Implementation: `pmset -a disablesleep 1` while the switch is on and at least one session
  is active; restore the previous value when the switch is off, when no session is active for
  `keepAwakeIdleMinutes` (default 15), and when AgentHerd quits. This needs administrator
  rights once per change (macOS password prompt) **(verify, Q12)**.
- Battery is allowed, with a floor: on battery, stop keeping awake below `keepAwakeMinBattery`
  (default 20%) and send a notice through the channel.
- If AgentHerd crashes, the next start restores the saved value. The saved value is stored
  in `config.json` before the first change.
- B is out of scope. The core stays free of Electron imports (ADR 0004), so B stays possible.

## Alternatives

- B (remote host): works with the laptop off, but needs remote auth, a network API instead
  of the Unix socket, and repos on the host. Too large for v1.
- Tell users to use clamshell mode: needs an external display.
- Third-party tools (Amphetamine and similar): extra install, no link to session activity.

## Consequences

- A closed laptop in a bag gets warm and uses battery. The desktop app says so next to the
  switch, and the battery floor limits the damage.
- Company device management may reset power settings. AgentHerd checks the value and shows
  a warning if it changed.
