# AGENTS.md

Instructions for coding agents (and humans) who change this repo. This file is the source.
`CLAUDE.md` is a short mirror; both carry the same `Policy-Sync` line. Change both in the
same commit.

Policy-Sync: 2026-11-04.5

## 1. Non-negotiable

These rules protect the user's machine, data and trust. Never set them aside.

1. **Fail toward the human.** On any error, timeout or unclear model output, the result is
   `escalate`, never `allow`. See ADR 0007.
2. **The guard list runs before rules and models** and can only escalate.
3. **Owner only.** Inbound channel actions from anyone but the owner are dropped.
4. **No secrets in logs, `herd.db`, cards, prompts or fixtures.** Use the redaction helper.
5. **Agent config files are only changed by an explicit export action**, with a backup.
   AgentHerd writes only its own block, `remove` deletes exactly that block, and a rule
   export may narrow a rule but never widen it.
6. **Do not copy code from PI-Desktop or OpenBot** (LGPL / noncommercial). See ADR 0009.
7. **`packages/protocol` is a contract.** A change updates the spec, the ACP client, every exporter and channel,
   and the tests in the same change.
8. **Git:** work on a branch, push it, open a pull request and merge it yourself; no review
   is needed. Never commit straight to `main`. Commit author is `zszz3`
   (configured in the repo). Never use `git reset --hard`, `git push --force`, `--no-verify`.

## 2. Defaults

Follow these unless the maintainer asks otherwise. If you set one aside, say which and why
in your report.

### Read before you change

1. `docs/spec/00-baseline.md`, then the spec pages for the area you change.
2. ADRs listed under "Applied ADRs" at the top of those pages.
3. The plan you are executing, if any (`plans/`).
4. `docs/spec/glossary.md` before you name anything.

### Docs stay in sync with code

| You change | You also update, in the same commit |
| --- | --- |
| Behavior | The spec page that describes it |
| An architecture boundary, a dependency direction, a hard-to-reverse choice | A new ADR (and the ADR index) |
| User-visible or protocol-visible behavior | An E2E scenario in `docs/spec/07-delivery.md` and its test |
| A verified fact behind an open question | `docs/spec/open-questions.md` (answer + evidence) |
| A plan's progress | Its row in `plans/README.md` |
| `README.md` | `README.zh-CN.md` |

### Code

- TypeScript strict, ES modules, Node.js 22+. No `any`, no `@ts-ignore` without a comment
  that explains why.
- Source files (`.ts`, `.tsx`, `.css`, `.js`, tests included) normally stay under 500 lines;
  `pnpm check` warns above 500 and fails above 800 (`scripts/check-lines.ts`). Only the forked
  Pi loop (`packages/herder-loop/src`, `test`) is exempt. Split by responsibility, not by line
  count.
- `core` has no Electron imports. The renderer has no Node access.
- Prefer E2E tests with `mock-agent` and `channel-fake`. Add unit tests for pure logic
  (rules, guard list, redaction, normalization, parsing).
- Run the narrow checks for what you changed. Do not claim a check passed if you did not run it.

### Language

- English for code, comments, docs, commit messages (ADR 0002). Short sentences, common words.
- Reply to the maintainer in the language they use.

### Commits

- Conventional Commits: `type(scope): summary` with types `feat`, `fix`, `docs`, `refactor`,
  `test`, `chore`, `build`, `ci`, `perf`.
- Add a body that says **why** for anything but trivial changes.
- One logical change per commit. Never hide a behavior change in a `refactor` commit.
- Commit only when the maintainer or the plan says so.

### When unsure

- Mark claims you could not verify, and say where you looked.
- If a plan's STOP condition happens, stop and report. Do not improvise.

## 3. Repo map

| Path | Content |
| --- | --- |
| `docs/spec/` | What the product does (numbered pages) |
| `docs/adr/` | Why it is built this way |
| `plans/` | Executable implementation plans and their states |
| `apps/desktop/` | Electron app (not yet created) |
| `packages/*` | Core, protocol, rules, ACP client, exporters, channels, mock agent (not yet created) |

## 4. Maintaining this file

Keep rules short and testable. A rule that a script can check should become a script.
Bump the `Policy-Sync` line and mirror the change in `CLAUDE.md`.
