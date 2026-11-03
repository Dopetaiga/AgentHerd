# CLAUDE.md

Short mirror of [AGENTS.md](AGENTS.md). AGENTS.md wins if they differ.

Policy-Sync: 2026-11-04.1

Non-negotiable:

- Fail toward the human: errors give `escalate` / `defer`, never `allow`.
- Guard list runs first and can only escalate. Owner-only channel actions.
- No secrets in logs, db, cards, prompts, fixtures.
- Hooks change only through explicit install with backup; uninstall removes only what install wrote.
- Do not copy code from PI-Desktop or OpenBot.
- `packages/protocol` changes update spec, adapters, channels and tests together.
- Commit only, never push. Author `zszz3`. No `reset --hard`, force push, `--no-verify`.

Defaults:

- Read `docs/spec/00-baseline.md`, the relevant spec pages, their ADRs, the plan, the glossary.
- Same commit: behavior → spec; boundary → ADR; visible behavior → E2E scenario; README → README.zh-CN.
- TypeScript strict, ESM, Node 22+, files ≲ 400 lines, core without Electron.
- English everywhere in the repo; reply in the maintainer's language.
- Conventional Commits with a "why" body. Do not claim unrun checks passed.
