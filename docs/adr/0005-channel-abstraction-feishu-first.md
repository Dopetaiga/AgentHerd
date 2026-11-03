# ADR 0005: Channel abstraction, Feishu first

- Status: Proposed
- Date: 2026-11-04
- Related: [05-channels.md](../spec/05-channels.md)

## Context

The owner must answer items away from the desk. The maintainer and the first users use
Feishu every day. Other users use Slack, Telegram and others. A Feishu prototype on
2026-11-04 showed that one QR scan (`registerApp`, OAuth device grant) creates a working
bot app, and that messages and card callbacks both arrive over the long connection.

## Decision

- The core talks to a `Channel` interface and renders items in a channel-neutral form.
- v1 ships only the Feishu channel (also serving Lark). Names in the core never say
  "feishu"; only `packages/channel-feishu` does.
- Feishu uses one-scan app registration and the long connection. No webhook, no public IP.

## Alternatives

- Feishu-specific core: faster now, expensive to undo.
- Start with a generic push service (Bark, ntfy): no buttons with callbacks, no replies.
- Manual Feishu app setup (create app, copy secret, set scopes, publish): the main reason
  similar tools are hard to set up.

## Consequences

- Each new chat app is one package plus a setup page and must pass the channel contract tests.
- Items must be answerable with text only, for channels without buttons.
