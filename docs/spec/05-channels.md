# 05. Channels

Applied ADR: [0005](../adr/0005-channel-abstraction-feishu-first.md).

A **channel** is the chat app through which AgentHerd reaches the owner. The core does not
know which chat app is in use. v1 ships one channel: **Feishu** (the same code serves Lark,
the international brand). Later channels: Slack, Telegram, Discord, DingTalk, WeCom, a
plain push service (Bark/ntfy).

## 1. Channel interface

```ts
interface Channel {
  id: string;                                   // "feishu"
  capabilities: ChannelCapability[];            // "buttons" | "free-text" | "update-message" | "files"
  setup(ui: SetupUI): Promise<ChannelBinding>;  // onboarding, e.g. QR scan
  start(binding: ChannelBinding, sink: InboundSink): Promise<void>;
  stop(): Promise<void>;
  sendItem(item: Item): Promise<MessageRef>;
  updateItem(ref: MessageRef, item: Item): Promise<void>; // show the final state
  sendText(text: string): Promise<MessageRef>;  // digests, progress, replies
}

type Inbound =
  | { kind: "action"; itemId: string; action: "allow" | "deny" | "always" | "answer"; text?: string; from: string }
  | { kind: "message"; text: string; from: string; replyTo?: MessageRef };
```

The core renders items into a channel-neutral `ItemView` (title, body, risk, options,
reason). Each channel turns it into its own message format. A channel without buttons must
still work: the user replies with a short code (`1` allow, `2` deny, or text).

Only messages from the owner are accepted. Every channel binding stores the owner's id;
inbound messages from anyone else are dropped and logged.

## 2. What the owner sees

| Message | When |
| --- | --- |
| Item card | An item needs the owner. One card per item. At most one open card per session; newer items for the same session queue behind it. |
| Final state | The card is updated in place: "Allowed by you", "Denied", "Expired (answered in terminal)". |
| Task progress | For tasks started from the chat app: started, waiting, done (with a summary). |
| Reminder | Every `remindMinutes` (default 30) while an item is open. |
| Daily digest | Optional. Counts, automatic decisions with reasons, decisions marked wrong. |

Commands the owner can send as plain text:

| Text | Effect |
| --- | --- |
| `status` | List sessions and their states |
| `run <dir> <prompt>` | Launch a task (launch-capable agent from settings) |
| Reply to a card | Answer that item |
| Reply to a progress message | Steer or continue that task |

## 3. Feishu channel

### Onboarding: one QR scan

Uses `registerApp` from `@larksuiteoapi/node-sdk` (1.61.1 or later), which implements the
Feishu "create agent app with one scan" flow (OAuth device grant). Tested in a prototype on
2026-11-04: one scan creates the app with the scopes, event and callback below, returns App
ID, App Secret and the owner's `open_id`, and no separate publish step is needed.

- App name: `<user name>'s AgentHerd`, created with `createOnly: true`.
- Scopes (tenant): `im:message`, `im:message:send_as_bot`, `im:message.p2p_msg:readonly`.
- Event: `im.message.receive_v1`. Callback: `card.action.trigger`.
- The desktop app shows the QR code and the state of the flow (waiting for scan, waiting for
  confirm, verifying, connected). The QR code is valid for one hour.
- After the scan the app verifies the credentials (tenant access token) and sends a welcome
  card.

### Connection

The Feishu long connection (WebSocket, `WSClient` with an `EventDispatcher`) receives both
messages and card callbacks. No public IP and no webhook URL are needed. The prototype
confirmed that `card.action.trigger` arrives over the long connection.

### Cards

Card JSON 2.0 with `update_multi: true`, so the card can be updated after an action. Card
callback values carry `{ itemId, action }`. The callback handler checks the owner, applies
the action once (duplicate callbacks are ignored), and returns a toast plus the updated card.

## 4. Adding a channel

A new channel is a package `channel-<id>` that implements the interface, plus a setup page
in the desktop app. It must pass the shared channel contract tests (send, update, owner
check, duplicate action, reply mapping).
