// Feishu channel (docs/spec/05-channels.md §3). The owner check and duplicate handling live
// in the core; the channel turns Feishu payloads into `Inbound` and views into cards.

import type {
  Channel,
  ChannelBinding,
  ChannelCapability,
  Inbound,
  InboundFile,
  InboundImage,
  InboundSink,
  Locale,
  MessageRef,
  SetupUI,
  View,
} from "@agentherd/protocol";
import { DEFAULT_LOCALE } from "@agentherd/protocol";
import * as lark from "@larksuiteoapi/node-sdk";
import {
  type Brand,
  type FeishuApi,
  type FeishuCredentials,
  sdkApi,
  verifyCredentials,
} from "./api.ts";
import { renderCard } from "./card.ts";
import { type FeishuMessage, parseCardAction, parseFeishuMessage } from "./inbound.ts";
import { CARD_TEXTS } from "./texts.ts";

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
  /** Language of owner-facing text. Default: Chinese. */
  locale?: Locale;
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
  private readonly locale: Locale;

  constructor(opts: FeishuChannelOptions) {
    this.opts = opts;
    this.locale = opts.locale ?? DEFAULT_LOCALE;
  }

  async setup(ui: SetupUI): Promise<ChannelBinding> {
    const register = this.opts.register ?? lark.registerApp;
    ui.showStatus("waiting-scan");
    const result = await register({
      source: "agentherd",
      createOnly: true,
      appPreset: { name: CARD_TEXTS[this.locale].appName, desc: CARD_TEXTS[this.locale].appDesc },
      addons: {
        scopes: { tenant: SCOPES },
        events: { items: { tenant: EVENTS } },
        callbacks: { items: CALLBACKS },
      },
      // No onStatusChange: its "polling" means authorization_pending, which Feishu answers
      // before and after the scan alike, so it cannot tell that the owner has scanned.
      onQRCodeReady: (info) => ui.showQrCode(info.url, info.expireIn),
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
    const deliver = async (inbound: Inbound | null) => {
      if (inbound === null) return;
      try {
        await sink(inbound);
      } catch (error) {
        this.opts.onError?.(error as Error);
      }
    };
    await api.connect({
      onMessage: async (payload) => {
        const message = parseFeishuMessage(payload);
        if (message !== null) await deliver(await this.withImages(api, message));
      },
      onCardAction: async (payload) => this.onCardAction(payload, deliver),
    });
    this.api = api;
  }

  async stop(): Promise<void> {
    await this.api?.close();
    this.api = null;
  }

  async send(view: View): Promise<MessageRef> {
    const id = await this.requireApi().sendCard(this.ownerId, renderCard(view, this.locale));
    return { channelId: CHANNEL_ID, id };
  }

  async update(ref: MessageRef, view: View): Promise<void> {
    // During a card callback, Feishu keeps showing the old card if it is patched before the
    // callback is answered (seen in the M1 manual run). So an update of the tapped card goes
    // into the callback response instead.
    const pending = this.callbacks.get(ref.id);
    if (pending !== undefined && !pending.answered) {
      pending.card = renderCard(view, this.locale);
      return;
    }
    await this.requireApi().patchCard(ref.id, renderCard(view, this.locale));
  }

  /** Downloads the images of a message. One that fails becomes a note in the text. */
  private async withImages(api: FeishuApi, m: FeishuMessage): Promise<Inbound> {
    const images: InboundImage[] = [];
    const notes: string[] = [];
    for (const key of m.imageKeys) {
      try {
        const file = await api.downloadImage(m.messageId, key);
        images.push({ mimeType: imageType(file.data, file.contentType), data: file.data });
      } catch (error) {
        notes.push(CARD_TEXTS[this.locale].imageFailed((error as Error).message));
      }
    }
    const files: InboundFile[] = [];
    for (const f of m.files) {
      try {
        const file = await api.downloadFile(m.messageId, f.key);
        files.push({ name: f.name, data: file.data });
      } catch (error) {
        notes.push(CARD_TEXTS[this.locale].fileFailed(f.name, (error as Error).message));
      }
    }
    const text = [m.text, ...notes].filter((t) => t !== "").join("\n");
    return {
      kind: "message",
      text,
      from: m.from,
      ...(m.replyTo === undefined ? {} : { replyTo: m.replyTo }),
      ...(images.length === 0 ? {} : { images }),
      ...(files.length === 0 ? {} : { files }),
    };
  }

  private async onCardAction(
    payload: unknown,
    deliver: (inbound: Inbound | null) => Promise<void>,
  ): Promise<Record<string, unknown>> {
    const toast = { type: "info", content: CARD_TEXTS[this.locale].toast };
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

/** The image type from its first bytes; Feishu may answer with a generic content type. */
export function imageType(data: Uint8Array, contentType?: string): string {
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45) return "image/webp";
  if (starts(0x42, 0x4d)) return "image/bmp";
  const type = contentType?.split(";")[0]?.trim();
  return type?.startsWith("image/") === true ? type : "image/png";
}
