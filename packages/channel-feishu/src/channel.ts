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
      onCardAction: async (payload) => {
        // Answer the callback at once; the core updates the card with `update`.
        void deliver(parseCardAction(payload));
        return { toast: { type: "info", content: "Received" } };
      },
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
    await this.requireApi().patchCard(ref.id, renderCard(view));
  }

  async pin(ref: MessageRef): Promise<void> {
    await this.requireApi().pin(ref.id);
  }

  private requireApi(): FeishuApi {
    if (this.api === null) throw new Error("feishu channel is not started");
    return this.api;
  }
}
