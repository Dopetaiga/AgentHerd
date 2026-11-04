# ADR 0022: Pi joins through a bundled ACP bridge with an approval gate

- Status: Accepted
- Date: 2026-11-04
- Related: [ADR 0015](0015-acp-is-the-only-runtime-protocol.md), [03-agents.md](../spec/03-agents.md#pi)

## Context

The maintainer wants DSH and Pi as the first two agents. DSH speaks ACP (`dsh acp`). Pi
(`@earendil-works/pi-coding-agent` 1.5.0) has no ACP server. It has an RPC mode
(`pi --mode rpc`, JSONL commands and events on stdio) and extensions. Pi never asks before a
tool call: "pi does not ask for approval before every tool call". An extension can block a
call (`pi.on("tool_call")` returns `{ block: true }`) and can ask the client a question over
RPC (`ctx.ui.select` becomes an `extension_ui_request`).

OpenBot drives Pi through its RPC mode with a native client. A community adapter `pi-acp`
(npm 0.0.34) wraps Pi RPC in ACP, but it has no approval gate.

## Decision

- AgentHerd ships `packages/pi-acp`: a small ACP agent (`bin/pi-acp.ts`) that starts
  `pi --mode rpc --no-session` for each ACP session and translates both ways. The core still
  talks only ACP (ADR 0015 holds).
- The bridge loads its own Pi extension (`extension/gate.ts`, `-e`). The gate asks before
  every tool call except `read`, `grep`, `find` and `ls` inside the session folder. It asks
  with `ctx.ui.select`; the bridge turns that into `session/request_permission` with
  `allow_once` / `reject_once`. No answer, an error, or a cancel blocks the call.
- Pi keeps its own login and settings. If the owner chooses a model for the `pi` role in
  AgentHerd, the host puts the pi-ai model (JSON, no secret) in `AGENTHERD_PI_MODEL` and the
  key in `AGENTHERD_PI_KEY`; a second bundled extension (`extension/model.ts`) registers it as
  provider `agentherd`, so built-in and OpenAI-compatible services both work and the key is
  never on a command line.

## Alternatives

- A native Pi RPC driver in the core (OpenBot's way): a second runtime protocol in the core,
  against ADR 0015.
- The community `pi-acp`: no approval gate, and one more third-party version to follow.
- Pi without a gate: Pi would run every command and write without the owner.

## Consequences

- One more process per Pi session (bridge plus Pi). The bridge is small and tested with a
  fake Pi that loads the real gate extension.
- Pi's RPC records and extension API are now a dependency. The bridge checks the Pi version
  it was tested with (1.5.0) only in docs; a format change shows up as a failed session.
- Pi models from custom OpenAI-compatible services are not passed in v1 (Pi needs its own
  `models.json` for them, and AgentHerd does not write Pi's config).
