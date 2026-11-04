// Feishu channel (docs/spec/05-channels.md §3). The owner check and duplicate handling live
// in the core; the channel turns Feishu payloads into `Inbound` and views into cards.

import type {
  Channel,
  ChannelBinding,
  ChannelCapability,
  InboundSink,
  MessageRef,
  SetupUI,
  View,
} from "@agentherd/protocol";
import * as lark from "@larksuiteoapi/node-sdk";
import {
  type Brand,
  type FeishuApi,
  type FeishuCredentials,
  sdkApi,
  verifyCredentials,
} from "./api.ts";
import { renderCard } from "./card.ts";
import { parseCardAction, parseMessage } from "./inbound.ts";

export const CHANNEL_ID = "feishu";

export const SCOPES = ["im:message", "im:message:send_as_bot", "im:message.p2p_msg:readonly"];
export const EVENTS = ["im.message.receive_v1"];
export const CALLBACKS = ["card.action.trigger"];

/** How long a card callback waits for the core before it answers without a new card. */
export const CALLBACK_WAIT_MS = 2000;

interface PendingCallback {
  answered: boolean;
  card?: Record<string, unknown>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

function openMessageId(payload: unknown): string | null {
  const root =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
  const event =
    root !== null && typeof root.event === "object" && root.event !== null ? root.event : root;
  const context = (event as Record<string, unknown> | null)?.context as
    | Record<string, unknown>
    | undefined;
  const id = context?.open_message_id;
  return typeof id === "string" && id !== "" ? id : null;
}

export interface FeishuChannelOptions {
  /** Looks up the App Secret for an App ID (keychain, safeStorage, …). */
  getSecret(appId: string): Promise<string>;
  /** Stores the App Secret after setup. The binding never holds it. */
  saveSecret(appId: string, secret: string): Promise<void>;
  /** Test seam. Default: the SDK. */
  createApi?: (creds: FeishuCredentials) => FeishuApi;
  /** Test seam. Default: `registerApp` from the SDK. */
  register?: typeof lark.registerApp;
  /** Test seam. Default: tenant access token check. */
  verify?: (creds: FeishuCredentials) => Promise<void>;
  /** Called when a sink throws; the channel never throws back into Feishu. */
  onError?: (error: Error) => void;
}

export class FeishuChannel implements Channel {
  readonly id = CHANNEL_ID;
  readonly capabilities: ChannelCapability[] = [
    "buttons",
    "free-text",
    "update-message",
    "pin",
    "table",
  ];
  private api: FeishuApi | null = null;
  private ownerId = "";
  private readonly callbacks = new Map<string, PendingCallback>();

  private readonly opts: FeishuChannelOptions;

  constructor(opts: FeishuChannelOptions) {
    this.opts = opts;
  }

  async setup(ui: SetupUI): Promise<ChannelBinding> {
    const register = this.opts.register ?? lark.registerApp;
    ui.showStatus("waiting-scan");
    const result = await register({
      source: "agentherd",
      createOnly: true,
      appPreset: { name: "{user}'s AgentHerd", desc: "Only pings you when your agents need you" },
      addons: {
        scopes: { tenant: SCOPES },
        events: { items: { tenant: EVENTS } },
        callbacks: { items: CALLBACKS },
      },
      onQRCodeReady: (info) => ui.showQrCode(info.url, info.expireIn),
      onStatusChange: (info) => {
        if (info.status === "polling") ui.showStatus("waiting-confirm");
      },
    } as Parameters<typeof lark.registerApp>[0]);
    const ownerId = result.user_info?.open_id;
    if (ownerId === undefined || ownerId === "") {
      throw new Error("Feishu did not return the owner's open_id");
    }
    const brand: Brand = result.user_info?.tenant_brand ?? "feishu";
    const creds = { appId: result.client_id, appSecret: result.client_secret, brand };
    ui.showStatus("verifying");
    await (this.opts.verify ?? verifyCredentials)(creds);
    await this.opts.saveSecret(creds.appId, creds.appSecret);
    ui.showStatus("connected");
    return { channelId: CHANNEL_ID, ownerId, data: { appId: creds.appId, brand } };
  }

  async start(binding: ChannelBinding, sink: InboundSink): Promise<void> {
    const appId = binding.data.appId;
    if (appId === undefined || appId === "") throw new Error("feishu binding has no appId");
    const brand: Brand = binding.data.brand === "lark" ? "lark" : "feishu";
    const appSecret = await this.opts.getSecret(appId);
    this.ownerId = binding.ownerId;
    const api = (this.opts.createApi ?? sdkApi)({ appId, appSecret, brand });
    const deliver = async (inbound: ReturnType<typeof parseMessage>) => {
      if (inbound === null) return;
      try {
        await sink(inbound);
      } catch (error) {
        this.opts.onError?.(error as Error);
      }
    };
    await api.connect({
      onMessage: async (payload) => deliver(parseMessage(payload)),
      onCardAction: async (payload) => this.onCardAction(payload, deliver),
    });
    this.api = api;
  }

  async stop(): Promise<void> {
    await this.api?.close();
    this.api = null;
  }

  async send(view: View): Promise<MessageRef> {
    const id = await this.requireApi().sendCard(this.ownerId, renderCard(view));
    return { channelId: CHANNEL_ID, id };
  }

  async update(ref: MessageRef, view: View): Promise<void> {
    // During a card callback, Feishu keeps showing the old card if it is patched before the
    // callback is answered (seen in the M1 manual run). So an update of the tapped card goes
    // into the callback response instead.
    const pending = this.callbacks.get(ref.id);
    if (pending !== undefined && !pending.answered) {
      pending.card = renderCard(view);
      return;
    }
    await this.requireApi().patchCard(ref.id, renderCard(view));
  }

  private async onCardAction(
    payload: unknown,
    deliver: (inbound: ReturnType<typeof parseCardAction>) => Promise<void>,
  ): Promise<Record<string, unknown>> {
    const toast = { type: "info", content: "Received" };
    const messageId = openMessageId(payload);
    if (messageId === null) {
      void deliver(parseCardAction(payload));
      return { toast };
    }
    const pending: PendingCallback = { answered: false };
    this.callbacks.set(messageId, pending);
    try {
      // Feishu waits about 3 s for the answer; give the core most of it.
      await Promise.race([deliver(parseCardAction(payload)), sleep(CALLBACK_WAIT_MS)]);
    } finally {
      pending.answered = true;
      if (this.callbacks.get(messageId) === pending) this.callbacks.delete(messageId);
    }
    if (pending.card === undefined) return { toast };
    return { toast, card: { type: "raw", data: pending.card } };
  }

  async pin(ref: MessageRef): Promise<void> {
    await this.requireApi().pin(ref.id);
  }

  private requireApi(): FeishuApi {
    if (this.api === null) throw new Error("feishu channel is not started");
    return this.api;
  }
}
