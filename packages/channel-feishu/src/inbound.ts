import type { Inbound } from "@agentherd/protocol";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The SDK may deliver events nested under `event` or flattened to the top level. */
function eventRoot(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  if (isRecord(payload.event)) return payload.event;
  return payload;
}

/**
 * Parse a Feishu `card.action.trigger` payload into an inbound action. Returns null on any
 * shape it does not recognize. A `value` that arrives as a JSON string is parsed first.
 */
export function parseCardAction(payload: unknown): Inbound | null {
  const data = eventRoot(payload);
  if (data === null) return null;

  const operator = isRecord(data.operator) ? data.operator : null;
  const openId =
    operator !== null && typeof operator.open_id === "string" ? operator.open_id : null;
  if (openId === null || openId === "") return null;

  const action = isRecord(data.action) ? data.action : null;
  if (action === null) return null;

  let value: unknown = action.value;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;

  const target = typeof value.target === "string" ? value.target : null;
  const act = typeof value.action === "string" ? value.action : null;
  if (target === null || act === null || target === "" || act === "") return null;

  return { kind: "action", target, action: act, from: openId };
}

/**
 * Parse a Feishu `im.message.receive_v1` payload into an inbound owner message. Returns null
 * for non-p2p chats, non-text messages, non-user senders, bad JSON, or empty text.
 */
export function parseMessage(payload: unknown): Inbound | null {
  const data = eventRoot(payload);
  if (data === null) return null;

  const sender = isRecord(data.sender) ? data.sender : null;
  if (sender === null || sender.sender_type !== "user") return null;

  const senderId = isRecord(sender.sender_id) ? sender.sender_id : null;
  const openId =
    senderId !== null && typeof senderId.open_id === "string" ? senderId.open_id : null;
  if (openId === null || openId === "") return null;

  const message = isRecord(data.message) ? data.message : null;
  if (message === null || message.chat_type !== "p2p" || message.message_type !== "text") {
    return null;
  }
  if (typeof message.content !== "string") return null;

  let content: unknown;
  try {
    content = JSON.parse(message.content);
  } catch {
    return null;
  }
  if (!isRecord(content)) return null;

  const text = typeof content.text === "string" ? content.text.trim() : null;
  if (text === null || text === "") return null;

  const parentId = typeof message.parent_id === "string" ? message.parent_id : null;
  if (parentId !== null && parentId !== "") {
    return { kind: "message", text, from: openId, replyTo: { channelId: "feishu", id: parentId } };
  }
  return { kind: "message", text, from: openId };
}
