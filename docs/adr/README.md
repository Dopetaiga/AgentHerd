# Architecture decision records

Format and rules: [ADR 0001](0001-record-architecture-decisions.md).

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-english-docs-chinese-readme.md) | English docs with a Chinese README mirror | Accepted |
| [0003](0003-herder-on-pi-agent-core.md) | Build the Herder on Pi agent core | Accepted |
| [0004](0004-electron-app-with-headless-core.md) | Electron desktop app with a headless core | Accepted |
| [0005](0005-channel-abstraction-feishu-first.md) | Channel abstraction, Feishu first | Accepted |
| [0006](0006-agent-adapters-attach-and-launch.md) | Agent adapters with attach and launch modes | Superseded by 0015 |
| [0007](0007-tiered-decisions-fail-open-to-human.md) | Tiered decisions that fail toward the human | Accepted |
| [0008](0008-observe-first-rollout.md) | Observe-first rollout | Accepted |
| [0009](0009-mit-license-reference-only.md) | MIT license, reference other projects without copying code | Accepted |
| [0010](0010-typescript-pnpm-monorepo.md) | TypeScript pnpm monorepo | Accepted |
| [0011](0011-keep-running-with-lid-closed.md) | Keep running with the lid closed (macOS) | Accepted |
| [0012](0012-channel-is-the-only-decision-surface.md) | The channel is the only place where the owner decides | Accepted |
| [0013](0013-macos-only-for-v1.md) | macOS only for v1 | Accepted |
| [0014](0014-acp-first-real-agent.md) | ACP is the first real agent integration | Accepted |
| [0015](0015-acp-is-the-only-runtime-protocol.md) | ACP is the only runtime protocol to agents | Accepted |
| [0016](0016-one-rule-source-exported-to-agents.md) | One rule source, exported to each agent's own config | Accepted |
| [0017](0017-resident-herder-per-project.md) | A resident Herder per project, on the strongest model, that manages agents | Superseded by 0018 |
| [0018](0018-one-herder-as-secretary-separate-approvals.md) | One Herder for all projects as a light-model secretary; approvals in a separate pipeline | Accepted |
| [0019](0019-relay-verbatim-board-and-reports.md) | Relay, verbatim messages, pinned board and completion reports | Accepted |
| [0020](0020-fork-pi-agent-loop-track-upstream.md) | Fork Pi's agent loop into the repo and follow its upstream; pi-ai pinned behind ModelClient | Accepted |
| [0021](0021-model-list-then-choose-per-role.md) | The owner keeps a list of model services, then chooses a model for each role | Accepted |
| [0022](0022-pi-through-a-bundled-acp-bridge.md) | Pi joins through a bundled ACP bridge with an approval gate | Accepted |
| [0023](0023-app-downloads-pinned-agent-clis.md) | The app downloads pinned agent CLIs; the owner does not install them | Superseded by 0024 |
| [0024](0024-follow-latest-releases-six-agents.md) | Agent downloads follow upstream's latest release; six agents and a check button | Accepted |
