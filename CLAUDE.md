# CLAUDE.md

Short mirror of [AGENTS.md](AGENTS.md). AGENTS.md wins if they differ.

Policy-Sync: 2026-11-04.8

Non-negotiable:

- Fail toward the human: errors give `escalate`, never `allow`.
- Guard list runs first and can only escalate. Owner-only channel actions.
- No secrets in logs, db, cards, prompts, fixtures.
- Agent configs change only through explicit export with backup; own block only; never widen a rule.
- Do not copy code from PI-Desktop or OpenBot.
- `packages/protocol` changes update spec, ACP client, exporters, channels and tests together.
- Branch → push → open a PR → merge it yourself (no review). Never commit to `main` directly. Author `zszz3`. No `reset --hard`, force push, `--no-verify`.

Defaults:

- Read `docs/spec/00-baseline.md`, the relevant spec pages, their ADRs, the plan, the glossary.
- Same commit: behavior → spec; boundary → ADR; visible behavior → E2E scenario; README → README.zh-CN.
- TypeScript strict, ESM, Node 22+, files: `pnpm check` warns > 3500 lines, fails > 5000, core without Electron.
- English everywhere in the repo; reply in the maintainer's language.
- Conventional Commits with a "why" body. Do not claim unrun checks passed.
