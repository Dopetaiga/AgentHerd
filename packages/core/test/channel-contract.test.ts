import { FakeChannel } from "@agentherd/channel-fake";
import { type FeishuApi, FeishuChannel, type FeishuHandlers } from "@agentherd/channel-feishu";
import type { MessageRef } from "@agentherd/protocol";
import { channelContract } from "./channel-contract.ts";

channelContract("fake", async () => {
  const channel = new FakeChannel("owner");
  return {
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    tap: (_ref, target, action, from) => channel.tap(target, action, from),
    say: (text, from) => channel.say(text, from),
    sentCount: () => channel.messages.length,
    shown: (ref) => JSON.stringify(channel.messages.find((m) => m.ref.id === ref.id)?.view ?? null),
  };
});

/** Records what the channel asks Feishu to do, and plays Feishu's side. */
class RecordingApi implements FeishuApi {
  handlers: FeishuHandlers | null = null;
  cards = new Map<string, Record<string, unknown>>();
  sent = 0;
  pinned: string[] = [];
  callbackResponses: Record<string, unknown>[] = [];

  async connect(handlers: FeishuHandlers) {
    this.handlers = handlers;
  }
  async close() {
    this.handlers = null;
  }
  async sendCard(_openId: string, card: Record<string, unknown>) {
    this.sent += 1;
    const id = `om_${this.sent}`;
    this.cards.set(id, card);
    return id;
  }
  async patchCard(messageId: string, card: Record<string, unknown>) {
    if (!this.cards.has(messageId)) throw new Error(`unknown message ${messageId}`);
    this.cards.set(messageId, card);
  }
  async pin(messageId: string) {
    this.pinned.push(messageId);
  }
}

channelContract("feishu (recorded API)", async () => {
  const api = new RecordingApi();
  const channel = new FeishuChannel({
    getSecret: async () => "test-secret",
    saveSecret: async () => {},
    createApi: () => api,
  });
  const settle = () => new Promise((r) => setTimeout(r, 10));
  return {
    channel,
    binding: {
      channelId: "feishu",
      ownerId: "ou_owner000",
      data: { appId: "cli_test", brand: "feishu" },
    },
    async tap(ref: MessageRef, target, action, from) {
      if (api.handlers === null) throw new Error("not connected");
      const response = await api.handlers.onCardAction({
        schema: "2.0",
        event: {
          operator: { open_id: from },
          action: { tag: "button", value: { target, action } },
          context: { open_message_id: ref.id, open_chat_id: "oc_chat000" },
        },
      });
      api.callbackResponses.push(response);
      // The callback answers at once; the core updates the card right after.
      await settle();
    },
    async say(text, from) {
      if (api.handlers === null) throw new Error("not connected");
      await api.handlers.onMessage({
        sender: { sender_id: { open_id: from }, sender_type: "user" },
        message: {
          message_id: "om_in",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text }),
        },
      });
    },
    sentCount: () => api.sent,
    shown: (ref) => JSON.stringify(api.cards.get(ref.id) ?? null),
  };
});
