# ADR 0024: Agent downloads follow upstream's latest release; six agents and a check button

- Status: Accepted
- Date: 2026-11-05
- Supersedes: [ADR 0023](0023-app-downloads-pinned-agent-clis.md) (the pin; the download flow stays)
- Related: [ADR 0022](0022-pi-through-a-bundled-acp-bridge.md), [03-agents.md](../spec/03-agents.md#managed-downloads)

## Context

The maintainer asked for more agents in the same GUI flow ("类似的，再搞几个agent？"), chose
OpenCode, Gemini CLI, Claude Code and Codex, asked that DSH be downloaded the same way ("dsh也应该是下载这种形式啊"),
and asked for a 验证 (check) button.

OpenBot, the reference, does not pin: it checks the latest upstream release at startup and on
request, takes the digest from the publisher (GitHub asset `digest`, npm `dist.integrity`), and
keeps a blocklist for bad versions. With six agents, hand-updating pins would always be behind.

Where each agent is published (2026-11-05):

| Agent | Source | Digest | Starts with |
|---|---|---|---|
| DSH | DeepSeek's update feed `download.deepseek.com/dsh-desk/feeds/<mac-arm64\|mac-x64>/nightly-mac.yml` (zip of the app) | sha512 in the feed | `…/runtime/cli/bin/dsh acp` |
| Pi | GitHub `earendil-works/pi` releases, `pi-<os>-<arch>.tar.gz` | asset sha256 | AgentHerd's bridge (ADR 0022) |
| OpenCode | GitHub `anomalyco/opencode`, `opencode-<os>-<arch>.zip` (mac) / `.tar.gz` (linux) | asset sha256 | `opencode acp` |
| Gemini CLI | GitHub `google-gemini/gemini-cli`, `gemini-cli-bundle.zip` (JavaScript) | asset sha256 | `node gemini.js --acp` |
| Claude Code | npm `@agentclientprotocol/claude-agent-acp` | npm integrity (sha512) per tarball | `node dist/index.js` |
| Codex | npm `@agentclientprotocol/codex-acp` | npm integrity per tarball | `node dist/index.js` |

The Gemini standalone binaries are unsigned on macOS, so the JavaScript bundle is used with the
app's own Node. Claude Code and Codex have no ACP server of their own; the ACP adapters from the
`agentclientprotocol` organisation are npm packages with native dependencies, so they need `npm`.

## Decision

- `packages/host/src/catalog.ts` lists the six agents: env override variable, names to find on
  `PATH`, ACP arguments, ask-first env, and a `latest(target)` resolver. A download always takes
  the latest release at that moment; there are no pins in the code.
- `packages/host/src/runtimes.ts` installs an archive (download, check the publisher's digest,
  unpack with `tar`/`ditto`/`unzip`, run `--version` when the build is runnable) or an npm
  package (`npm install --ignore-scripts --omit=dev` into a staging folder; npm checks each
  tarball's integrity). npm itself is downloaded the same way (registry tarball, sha512) the first
  time an npm agent is installed. The checked copy moves to `<home>/runtimes/<id>/<version>/`,
  `current.json` names it, older versions are removed.
- Ask-first settings per agent: DSH `DSH_PERMISSION_MODE=read-only`; Pi through the gate;
  OpenCode `OPENCODE_PERMISSION={"edit":"ask","bash":"ask","webfetch":"ask"}`; Codex
  `INITIAL_AGENT_MODE=read-only`; Claude Code and Gemini ask by default.
- Lookup order for every agent: its env variable (`AGENTHERD_<ID>`), the app's download, its
  command on the search `PATH`, then (DSH) `/Applications/DeepSeek Harness.app`.
- The Agent page shows all six with 下载 / 更新 / 取消 / 移除 and a **验证** button. 验证 starts the
  agent's ACP server in an empty temporary folder, runs `initialize` and `session/new`, and
  closes it (60 s limit). It reports the agent's name and version, or that it needs a sign-in
  (ACP `authMethods` or an auth error), or the error with the last stderr lines, including
  "killed by SIGKILL" when the system stops the process.
- Agents that use their own account (Claude Code, Codex, Gemini, OpenCode) are signed in by the
  owner with the agent's own CLI; the page says how.

## Alternatives considered

- **Keep pins (ADR 0023).** Rejected: six pins to update by hand; OpenBot shows following latest
  with the publisher's digest is workable.
- **Gemini standalone binary.** Rejected: unsigned on macOS.
- **Use the system `npm`.** Rejected: the owner may have no Node or an old one.
- **A blocklist like OpenBot's.** Deferred until a bad release happens.

## Consequences

- A download can bring a release AgentHerd has not been tried with; 验证 and the permission
  checks in each agent are the guard. A broken release is fixed by 移除 + waiting, or a blocklist.
- The host contacts `api.github.com` (60 unauthenticated requests per hour), `registry.npmjs.org`
  and `download.deepseek.com` only when the owner presses 下载 / 更新.
- `startAgent` gained an abort signal and kills an agent that ignores SIGTERM after 3 s, so a
  failed check never leaves a process behind.
