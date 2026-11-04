# Plan 001: The workspace builds, and protocol types and rules are tested

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat c9f52e2..HEAD -- docs/spec packages`.
> If files changed in a way that makes "Current state" wrong, STOP.

## Status

- Milestone: M1
- Size: M
- Risk: LOW
- Depends on: none
- Planned at: `c9f52e2`, 2026-11-04

## Why this matters

Every later package imports the shared types in `packages/protocol` and the deterministic
decision code in `packages/rules` (guard list, rule matcher, command normalization,
redaction). These are the parts that must never be wrong, because they run before any model
and decide what is safe ([04-herder.md §3](../docs/spec/04-herder.md#3-approval-pipeline),
[06-security.md](../docs/spec/06-security.md)).

## Current state

- The repo has docs only: `docs/`, `plans/`, `AGENTS.md`, `CLAUDE.md`, `README*.md`, `LICENSE`.
- No `package.json`, no `packages/`.
- Local toolchain: Node 26.7.0, pnpm 11.18.0. The project supports Node 22.13 or later.

## Scope

**In scope:**

- Root workspace: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`,
  `vitest.config.ts`, `.editorconfig`, `.npmrc`.
- `packages/protocol`: types only, plus small runtime schema guards where input crosses a
  boundary.
- `packages/rules`: `normalizeCommand`, `matchRule`, the guard list, `redact`.

**Out of scope:**

- ACP, channels, storage, the Herder, exporters, the desktop app.
- A build step. Packages are consumed as TypeScript source in M1 (see Maintenance notes).

## Commands you will need

```bash
pnpm install
pnpm check          # biome lint + tsc --noEmit for every package
pnpm test           # vitest run, all packages
pnpm --filter @agentherd/rules test
```

## Steps

### Step 1: Root workspace

- `package.json` (private, `"type": "module"`, `"engines": { "node": ">=22.13" }`,
  `"packageManager": "pnpm@11.18.0"`). Scripts:
  - `check`: `biome check . && pnpm -r --parallel typecheck`
  - `test`: `vitest run`
  - `format`: `biome format --write .`
- Dev dependencies (root only): `typescript` (latest 5.x or 6.x), `@biomejs/biome`, `vitest`,
  `@types/node`, `tsx`.
- `pnpm-workspace.yaml`: `packages: ["packages/*", "apps/*"]`.
- `tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess: true`,
  `exactOptionalPropertyTypes: true`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`,
  `target: "ES2023"`, `verbatimModuleSyntax: true`, `allowImportingTsExtensions: true`,
  `noEmit: true`, `skipLibCheck: true`.
- `biome.json`: recommended rules; `noExplicitAny: error`; 2-space indent; line width 100;
  ignore `docs/`, `plans/`.
- `vitest.config.ts`: `test.include: ["packages/*/test/**/*.test.ts"]`.
- `.gitignore` already exists; add `node_modules/`, `coverage/`, `*.tsbuildinfo` if missing.

**Verify:** `pnpm install && pnpm check` → exits 0 (no packages yet is fine).

### Step 2: `packages/protocol`

Package `@agentherd/protocol`, `"exports": { ".": "./src/index.ts" }`, script
`typecheck: tsc --noEmit -p .`.

Define, with names from [glossary.md](../docs/spec/glossary.md):

- `SessionState` = `"starting" | "working" | "waiting-approval" | "idle" | "looping" | "error" | "ended"`
  ([03-agents.md §1](../docs/spec/03-agents.md#session-states)).
- `Mode` = `"observe" | "assist" | "auto"`.
- `Risk` = `"low" | "medium" | "high"`.
- `AgentProfile` `{ id; name; command: string[]; env: Record<string, string>; exporter: string | null }`.
- `ToolCallInfo` `{ kind: string; title: string; command?: string; paths: string[]; rawInput?: unknown }`
  — channel-neutral description of what the agent wants to do. No ACP types.
- `Item` `{ id; sessionId; profileId; cwd; kind: "permission" | "notification"; state: "open" | "decided" | "expired"; createdAt; toolCall?: ToolCallInfo; title; body; risk; decision?: Decision }`.
- `Decision` exactly as in [04-herder.md §3 Output](../docs/spec/04-herder.md#output).
- `Rule` `{ id; action: "allow" | "deny"; match: RuleMatch; createdAt; createdBy: "owner" | "always-button" }`
  and `RuleMatch` `{ profileId?; eventType?: "permission"; toolKind?; command?: string /* glob on normalized command */; pathScope?: { kind: "cwd" } | { kind: "dir"; path: string } }`
  ([04-herder.md §3 Rules](../docs/spec/04-herder.md#rules)).
- `ItemView`, `Channel`, `ChannelCapability`, `ChannelBinding`, `InboundSink`, `Inbound`,
  `MessageRef`, `SetupUI` exactly as in [05-channels.md §1](../docs/spec/05-channels.md#1-channel-interface).
  `ChannelBinding` holds `{ channelId; ownerId; data: Record<string, string> }` and **no secrets**
  (secrets are looked up by key at `start`).
- `isInbound(value: unknown): value is Inbound` — a hand-written guard (no schema library in M1).

**Verify:** `pnpm --filter @agentherd/protocol typecheck` → exits 0.

### Step 3: `packages/rules` — command normalization

`normalizeCommand(cmd: string): string`:

- trim; collapse runs of whitespace to one space;
- strip leading `env` assignments (`FOO=1 BAR=2 pnpm test` → `pnpm test`);
- strip a leading `cd <dir> &&` (record nothing about it; the cwd check uses paths);
- keep everything else verbatim (no quote parsing beyond what the tests need).

`commandHead(cmd)`: the first two words of the normalized command (`pnpm test`, `git status`).

Unit tests: `packages/rules/test/normalize.test.ts`, at least 10 cases.

**Verify:** `pnpm --filter @agentherd/rules test` → all pass.

### Step 4: `packages/rules` — guard list

`guardCheck(call: ToolCallInfo, ctx: { cwd: string; home: string }): { hit: true; reason: string } | { hit: false }`.

Built-in entries (from [04-herder.md](../docs/spec/04-herder.md#guard-list-always-to-the-owner)), each with an id and a reason string:

| Id | Hits when |
| --- | --- |
| `rm-outside-cwd` | `rm` with `-r`/`-R`/`-rf`/`--recursive` and a target that resolves outside `cwd`, or is `/`, `~`, `$HOME`, `*` at root |
| `force-push` | `git push` with `--force`, `-f` or `--force-with-lease` |
| `pipe-to-shell` | a download (`curl`, `wget`) piped into `sh`, `bash`, `zsh`, `python`, `node` |
| `secret-read` | any path or command argument under `~/.ssh`, `~/.aws`, `~/.gnupg`, a file named `.env` or `.env.*`, `security find-*-password` |
| `self-config` | any path under `~/.agentherd`, `~/.claude/settings*.json`, `~/.codex/`, `.claude/settings*.json` |
| `sudo` | command starts with `sudo` |

Rules for the implementation:

- Check every segment of a compound command (`&&`, `||`, `;`, `|`).
- A command the checker cannot parse returns `hit: true` with reason `unparsed` (fail toward
  the human).
- `guardCheck` is pure. `extraGuards` can be passed in by configuration but cannot remove a
  built-in entry.

Unit tests: `packages/rules/test/guard.test.ts`, at least 3 hit and 2 miss cases per entry,
plus compound commands and the `unparsed` case.

**Verify:** `pnpm --filter @agentherd/rules test` → all pass.

### Step 5: `packages/rules` — rule matcher

`matchRules(rules: Rule[], item: Item): { rule: Rule; action: "allow" | "deny" } | null`:

- A rule matches when every field it sets matches. `command` is a glob (`*` = any characters,
  no other syntax) against `normalizeCommand(item.toolCall.command)`.
- `pathScope: { kind: "cwd" }` matches only if every path in `toolCall.paths` is inside
  `item.cwd` after `path.resolve`. No paths means the scope matches only if the command has
  no path arguments outside `cwd` that the normalizer can see; when unsure, no match.
- **`deny` wins over `allow`** when both match. Among the same action, the first rule wins.
- The matcher never runs on an item that hit the guard list (the caller enforces this; the
  matcher has no guard logic).

Unit tests: `packages/rules/test/match.test.ts`, covering each field, deny-over-allow, glob
edges, symlink-free path escape (`../`), and an item with no `toolCall`.

**Verify:** `pnpm --filter @agentherd/rules test` → all pass.

### Step 6: `packages/rules` — redaction

`redact(text: string, env?: Record<string, string>): string` per
[06-security.md §2](../docs/spec/06-security.md#2-secrets):

- Replace known formats with `«redacted»`: `sk-…` keys, `ghp_`/`gho_`/`github_pat_` tokens,
  `xox[abp]-` Slack tokens, AWS `AKIA…`, JWTs (`eyJ…\.…\.…`), PEM private key blocks,
  `Bearer <token>`.
- Replace values of `NAME=value` and `"name": "value"` where the name contains `KEY`,
  `TOKEN`, `SECRET` or `PASSWORD` (case-insensitive).
- Replace any literal value from `env` whose key matches the same names.

Unit tests: `packages/rules/test/redact.test.ts`, one case per format, plus a negative case
that ordinary text is unchanged.

**Verify:** `pnpm test` → all pass; `pnpm check` → exits 0.

### Step 7: Commit

Commit as `feat(rules): add workspace, protocol types, guard list, matcher and redaction`
with a body that says why (deterministic checks run before any model).

**Verify:** `git log -1 --format='%an %s'` → `zszz3 feat(rules): …`.

## Test plan

Unit tests only (pure logic): normalize, guard, match, redact. No E2E in this plan.

## Done criteria

- [ ] `pnpm check` and `pnpm test` exit 0.
- [ ] No `any`, no `@ts-ignore`.
- [ ] Every guard list entry has hit and miss tests.
- [ ] `plans/README.md` state set to `DONE`.

## STOP conditions

- A fact in the spec turns out to be wrong (record it in `docs/spec/open-questions.md`).
- A type in Step 2 cannot be written as specified without changing a spec page.
- A check fails twice after a fix attempt.

## Maintenance notes

- Done 2026-11-04. Differences from the steps above, all toward the human: `guardCheck`
  returns `{ hit: true; id; reason }`; `matchRules(rules, item, home)` takes the home
  directory for `~`; allow rules never match compound or unparsed commands; the guard list
  also covers `doas`, `xargs rm -r`, `find -exec rm -r`, `git push +ref`, `curl -d @file`,
  more interpreters (`perl`, `ruby`, `dash`, `fish`), and `kind: "delete"` tool calls. The
  shell splitter is `packages/rules/src/shell.ts`; it throws `UnparsedCommandError` on
  `$(…)`, backticks, `<(…)` and unbalanced quotes.
- `normalizeCommand` and `redact` were written by a DeepSeek V4 Pro agent and reviewed.

- No build step in M1: packages export `./src/index.ts`; tests run with vitest and the CLI
  runs with `tsx`. A build (`tsdown`) is added when the desktop app needs bundles (M2).
- The guard list is intentionally coarse. A false hit costs one owner tap; a miss can cost
  data. Prefer false hits.
