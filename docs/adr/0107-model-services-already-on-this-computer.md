# ADR 0107: Model services already set up on this computer are found and offered

Status: Accepted · 2026-11-27

## Context

Every model service had to be typed into AgentHerd by hand: pick a vendor or an address, paste the key, tick models. Most owners already have the same keys in other agent apps on the same computer: Claude Code, Codex, CC Switch, DeepSeek Harness, Pi, OpenCode, or an environment variable.

The owner asked (2026-11-27): 「我意思是主动探测有哪些 key 之类的」, then 「我觉得是默认可以找，然后也有一个探测的按钮」.

magpie (`internal/provider/importapps.go`) and agentrecall (`core/agent-model-imports.ts`) already do this. Both only read the other apps' files, list what they find, and add a service only when the user picks it.

## Decision

1. **Where AgentHerd looks.** `packages/host/src/key-finder.ts` reads:
   - Claude Code `~/.claude/settings.json` (`env`)
   - CC Switch `~/.cc-switch/cc-switch.db` (read-only)
   - Codex `~/.codex/config.toml` + `auth.json`
   - DeepSeek Harness `~/.dsh/profiles/*/cordis.patch.yml` + `.credentials.yaml`
   - Pi `~/.pi/agent/models.json` + `auth.json`
   - OpenCode `auth.json`
   - environment variables pi-ai knows, such as `DEEPSEEK_API_KEY`

   The usual overrides (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `DSH_HOME`, `PI_CODING_AGENT_DIR`, `XDG_DATA_HOME`) are honoured.
2. **It only reads.** It writes no other app's file, runs no command that prints a key (Pi `!command`, `{env:…}` references), opens no Keychain and reads no account sign-in; plans have 用订阅登录 (ADR 0068). One app's broken file never hides what the others hold; it shows up as a note instead.
3. **What can be used.** A provider pi-ai knows becomes a built-in service; an address speaking OpenAI chat completions or Anthropic messages becomes a custom one. A service only offered in OpenAI's Responses format is left out with a note, because AgentHerd's custom services do not speak it.
4. **One service per address and key.** The same key at the same address is one row however many apps use it. A row matching a service already in AgentHerd (same vendor or address and format, same key) is marked 「已加为…」.
5. **On by default, plus 探测.** The first time the 模型 page (or the first run's service step) asks, the host looks. The section 「这台电脑上已有的服务」 then shows what was found, and 「探测」 looks again. Nothing is added until the owner taps 添加.

   *Changed 2026-11-27.* The owner said of the first version: 「点击这个探测的感觉很奇怪，没有交互，然后就是我这里探测到的，我不希望一直列这么大，我希望可以小一点……然后我是可以x掉的」. Now, like agentrecall's discovery bar:
   - What can still be added shows as one small dashed box of chips under the services (name · first model · where from), not a list of big rows. Services already in AgentHerd are not shown.
   - 探测 turns while it looks (at least 0.7 s), then says what it found for a few seconds (「看完了，多了 2 个可以加的」 or 「没有新的」), and new chips get a ring.
   - Every chip has a ×. A service put away stays away across looks and restarts: the config keeps a short hash of its place and key (`foundHidden`, never the key), and 「已隐藏 N 个 · 恢复」 brings them all back.
6. **Adding.** The service gets an id from its name that is not in use, the key goes into AgentHerd's own secrets as for a typed key, and the models the app named are ticked. A custom service the app named no models for is asked for its list (`GET /models`). If it lists up to 30 models, all are ticked; if more, only the first, and the owner ticks the rest. A known vendor named without a model gets pi-ai's first model.
7. **Keys stay in the host.** The app sees only `sk-a…9f2c`. Found rows have ids salted per start, so an id is never a fingerprint of a key.

## Alternatives

- **Add everything found by itself.** Rejected: a stale or someone else's key would become a live service without the owner looking at it.
- **Only a button, nothing by default.** Rejected: the owner asked for default finding.
- **Run Pi's `!command` keys or read the Keychain.** Rejected: running other apps' commands or opening the Keychain to get keys is more than reading settings.
- **Support OpenAI Responses-only services.** Left for later; the custom service would need a third format.

## Consequences

- An owner with Claude Code, DSH or CC Switch set up can add a working service in one tap.
- Looking takes a few milliseconds (13 ms on the owner's Mac, 10 services).
- A key copied in is a copy: if the other app's key changes, AgentHerd keeps the old one until the owner edits it.

## Tests

`packages/host/test/key-finder.test.ts` (each app's format, CC Switch database, environment, merging, already-added match, key hint, ids, TOML strings), `packages/host/test/host.test.ts` (find, add with key and listed models, already added, gone), `apps/desktop/test/found-services.test.ts`.
