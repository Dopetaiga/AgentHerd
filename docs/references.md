# References

AgentHerd learns from these projects. It does not copy their code (see
[ADR 0009](adr/0009-mit-license-reference-only.md)).

| Project | License | What we take |
| --- | --- | --- |
| [PI-Desktop](https://github.com/vastsa/PI-Desktop) | LGPL-3.0 | Docs-first start (spec tree, ADRs, frozen baseline before code); AGENTS.md as source with a CLAUDE.md mirror; the look of an Electron + React + Tailwind desktop app (sidebar, settings, permission cards, onboarding) |
| [OpenBot](https://github.com/nightly-labs/openbot) | PolyForm Noncommercial 1.0.0 | Executable plans (`plans/NNN-*.md` with Verify steps and STOP conditions, one state table); non-negotiable vs default rules in AGENTS.md; how to drive Codex app-server, Claude Code and ACP agents; chat-app integrations |
| [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) | MIT | "Take as little human attention as possible"; observe mode; a panel that shows only what needs a person |
| [Feishu one-scan agent app](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview) | — | `registerApp` in `@larksuiteoapi/node-sdk`: one scan returns App ID, App Secret and the owner's `open_id`; long connection for messages and card callbacks |
| [botmux](https://github.com/deepcoldy/botmux), [cc-connect](https://github.com/chenhg5/cc-connect) | — | Setup experience for Feishu bots that bridge to coding agents |
| [Pi](https://github.com/earendil-works/pi) | MIT | Agent core for the Herder's L2 step |
