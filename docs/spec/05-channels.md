# 05. Channels

Applied ADRs: [0005](../adr/0005-channel-abstraction-feishu-first.md), [0019](../adr/0019-relay-verbatim-board-and-reports.md).

A **channel** is the chat app through which AgentHerd reaches the owner. The core does not
know which chat app is in use. v1 ships one channel: **Feishu** (the same code serves Lark,
the international brand). Later channels: Slack, Telegram, Discord, DingTalk, WeCom, a
plain push service (Bark/ntfy).

## 1. Channel interface

```ts
interface Channel {
  id: string;                                   // "feishu"
  capabilities: ChannelCapability[];            // "buttons" | "free-text" | "update-message" | "pin" | "table" | "files"
  setup(ui: SetupUI): Promise<ChannelBinding>;  // onboarding, e.g. QR scan
  start(binding: ChannelBinding, sink: InboundSink): Promise<void>;
  stop(): Promise<void>;
  send(view: View): Promise<MessageRef>;
  update(ref: MessageRef, view: View): Promise<void>; // in place, no new notification
  pin(ref: MessageRef): Promise<void>;
}

type View = ItemView | BoardView | ReportView | RelayView | TextView;

type Inbound =
  | { kind: "action"; target: string; action: string; text?: string; from: string }
  | { kind: "message"; text: string; from: string; replyTo?: MessageRef };
```

The core renders channel-neutral views: `ItemView` (title, body, risk, options, reason),
`BoardView` (task rows), `ReportView` (completion report), `RelayView` (active relay),
`TextView` (agent or Herder text with a task label). Each channel turns them into its own
message format. A channel without buttons must still work: the user replies with a short code
(`1` allow, `2` deny, or text). A channel without `pin` or `update-message` sends a new board
on `status` instead.

Only messages from the owner are accepted. Every channel binding stores the owner's id;
inbound messages from anyone else are dropped and logged.

## 2. What the owner sees

The owner talks to one bot in a direct chat. What it sends there:

| Message | When | Notifies? |
| --- | --- | --- |
| Task board | One pinned card. Rows: task, stage, project, agent, last report, updated. Tasks that need the owner come first. Updated in place by code when a stage changes; a select menu under the table starts a relay. | Only when first sent |
| Item card | An approval or an agent question. One card per item, labeled with its task. At most one open card per session; newer items for the same session queue behind it. Updated in place with the final state: "Allowed by you", "Allowed by rule", "Denied". | Yes |
| Agent text | During a relay: everything the agent says, verbatim, with a task prefix | Yes |
| Completion report | Every time a task ends (done, blocked, failed): title, what was done, verification, outputs, risks, automatic decisions; buttons "Relay to this task" and "Full transcript" | Yes |
| Relay status | While a relay is active: "Talking to <task>", "End relay" button | When it starts and ends |
| Reminder | Every `remindMinutes` (default 30) while an item is open | Yes |
| Daily digest | On by default, can be turned off. Done today, still running, automatic decisions with reasons, decisions marked wrong | Yes |

Long messages are folded, never shortened: over `foldChars` (default 600) the card shows the
first lines and puts the rest in a collapsible panel; code blocks and logs are collapsed; over
the card size limit the text is stored as a file and sent as a link.

Tool-call activity of agents is stored, not sent. Nothing the agent says to the owner is
filtered ([ADR 0019](../adr/0019-relay-verbatim-board-and-reports.md)).

Commands (see [04-herder.md §1](04-herder.md#inbound) for routing):

| Text | Effect |
| --- | --- |
| Any text | To the Herder, or to the relayed session during a relay |
| `status` | Send the board (and pin it again if needed) |
| `/herder <text>` | To the Herder during a relay |
| `/end` | End the relay |
| `/interrupt <text>` | Cancel the relayed session's turn, then send the text |
| Reply to an item card | Answer that item |

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
callback values carry `{ target, action }`. The callback handler checks the owner, applies
the action once (duplicate callbacks are ignored), and returns a toast plus the updated card.

The board uses the card `table` component. Tested in the prototype on 2026-11-04
(`feishu-proto/board.ts`): a 6-column table with `options` (colored stage tags) and `lark_md`
columns was sent, pinned with `im.v1.pin.create` using the scopes above, and updated twice in
place with `im.v1.message.patch`. Limits from the Feishu docs and the test:

- at most 5 tables per card; a table must be at the card root; cells cannot hold buttons, so
  actions on a row use a select menu or a link under the table;
- `page_size` 1–10 rows, with paging; first column can be frozen;
- a column width of `70px` was rejected (error `200912`); `80px` worked.

Whether an in-place update makes a notification sound on the phone, and how the pin shows in a
direct chat, are open (Q13).

## 4. Adding a channel

A new channel is a package `channel-<id>` that implements the interface, plus a setup page
in the desktop app. It must pass the shared channel contract tests (send, update, owner
check, duplicate action, reply mapping).
