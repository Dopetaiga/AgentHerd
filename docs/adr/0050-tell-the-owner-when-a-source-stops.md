# ADR 0050: Tell the owner when a source stops answering

- Status: Accepted
- Date: 2026-11-08
- Amends: [ADR 0047](0047-follow-the-pull-requests-tasks-open.md) and
  [ADR 0048](0048-watch-mail-only-when-asked.md) (their "Failures")

## Context

Pull requests are followed with `gh` (ADR 0047) and mail is watched through Composio (ADR 0048).
When `gh` is missing, logged out or offline, or Gmail's connection expires, each failure was only
audited (`github.error`, `mail.error`). The owner kept believing they would hear about reviews
and mail while nothing was looked at. super-agent tells a person once when a source keeps failing
and again when it is back.

A cause seen on Windows: the desktop app started from the Start menu has no `HTTPS_PROXY`, while
the owner's browser uses the system proxy. `gh` then cannot reach GitHub although the owner can.

## Decision

- Core `SourceHealth` (`packages/core/src/source-health.ts`) tracks each watched source
  (`github`, `mail`): the first failure time, the last error, and whether the owner was told.
  It is kept in store state `sources.health`, so a restart does not reset the clock.
- A failure is audited once per distinct error (`github.error`, `mail.error`), as before. When
  a source has failed for 30 minutes without one success (`sourceDownMinutes`), the owner gets
  one alarm-toned message saying which updates stopped and what to do when the error tells:
  「PR 提醒停了：gh 没有登录，请运行 gh auth login。」, 「PR 提醒停了：这台电脑上找不到 gh 命令……」, or
  「邮件提醒停了：已经 30 分钟查不了 Gmail，恢复后会告诉你。」 Audit `source.down`.
- The first success after that says so once (「PR 提醒恢复了。」, audit `source.up`). Successes
  that follow failures the owner was not told about say nothing.
- When the last mail watch is removed, mail's failure state is forgotten: nothing is looked at,
  so nothing is down.
- The Herder sees failing sources in `session_list`, so it can answer 「为什么没提醒我」.
- The host runs `gh` with the system proxy (`packages/host/src/proxy.ts`): on Windows from
  `HKCU\...\Internet Settings` (`ProxyEnable`, `ProxyServer`), on macOS from `scutil --proxy`,
  passed as `HTTPS_PROXY`/`HTTP_PROXY` unless the environment already has a proxy.

## Consequences

- A short outage (sleep, a network change) costs no message; a lasting one costs two.
- Messages stay within ADR 0049's 100 words.
- `agentherd run` follows no sources and is unchanged.

## Alternatives

- Tell at the first failure: rejected, a laptop waking up would message every time.
- A status page in Settings: not now; the owner reads Feishu, and the Herder can answer.
