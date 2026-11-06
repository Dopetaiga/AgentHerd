// The small part of the Feishu Open Platform that the channel uses. `FeishuApi` is the seam
// for tests: the contract tests pass a recording stub, production uses `sdkApi`.

import * as lark from "@larksuiteoapi/node-sdk";

export type Brand = "feishu" | "lark";

export interface FeishuCredentials {
  appId: string;
  appSecret: string;
  brand: Brand;
}

export interface FeishuHandlers {
  onMessage(payload: unknown): Promise<void>;
  /** The return value is sent back to Feishu as the callback response. */
  onCardAction(payload: unknown): Promise<Record<string, unknown>>;
}

export interface FeishuApi {
  connect(handlers: FeishuHandlers): Promise<void>;
  close(): Promise<void>;
  /** Sends an interactive card to a user; returns the message id. */
  sendCard(openId: string, card: Record<string, unknown>): Promise<string>;
  patchCard(messageId: string, card: Record<string, unknown>): Promise<void>;
  pin(messageId: string): Promise<void>;
  /** Downloads an image of a received message (`im:message` covers it). */
  downloadImage(messageId: string, imageKey: string): Promise<DownloadedFile>;
}

export interface DownloadedFile {
  data: Uint8Array;
  /** From the response, when Feishu sends one. */
  contentType?: string;
}

export function openApiBase(brand: Brand): string {
  return brand === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
}

interface ApiResult {
  code?: number | undefined;
  msg?: string | undefined;
}

function check(op: string, res: ApiResult): void {
  if (res.code !== undefined && res.code !== 0) {
    throw new Error(`feishu ${op} failed: ${res.code} ${res.msg ?? ""}`.trim());
  }
}

/** Production implementation on top of `@larksuiteoapi/node-sdk`. */
export function sdkApi(creds: FeishuCredentials): FeishuApi {
  const base = {
    appId: creds.appId,
    appSecret: creds.appSecret,
    domain: creds.brand === "lark" ? lark.Domain.Lark : lark.Domain.Feishu,
  };
  const client = new lark.Client(base);
  let ws: lark.WSClient | null = null;

  return {
    async connect(handlers) {
      const dispatcher = new lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data: unknown) => {
          await handlers.onMessage(data);
        },
        "card.action.trigger": async (data: unknown) => handlers.onCardAction(data),
      } as never);
      ws = new lark.WSClient({ ...base, loggerLevel: lark.LoggerLevel.warn });
      await ws.start({ eventDispatcher: dispatcher });
    },
    async close() {
      ws?.close();
      ws = null;
    },
    async sendCard(openId, card) {
      const res = await client.im.v1.message.create({
        params: { receive_id_type: "open_id" },
        data: { receive_id: openId, msg_type: "interactive", content: JSON.stringify(card) },
      });
      check("send", res);
      const id = res.data?.message_id;
      if (id === undefined) throw new Error("feishu send returned no message_id");
      return id;
    },
    async patchCard(messageId, card) {
      const res = await client.im.v1.message.patch({
        path: { message_id: messageId },
        data: { content: JSON.stringify(card) },
      });
      check("patch", res);
    },
    async pin(messageId) {
      const res = await client.im.v1.pin.create({ data: { message_id: messageId } });
      check("pin", res);
    },
    async downloadImage(messageId, imageKey) {
      const res = await client.im.v1.messageResource.get({
        params: { type: "image" },
        path: { message_id: messageId, file_key: imageKey },
      });
      const chunks: Buffer[] = [];
      for await (const chunk of res.getReadableStream()) chunks.push(Buffer.from(chunk));
      const type = (res.headers as Record<string, unknown> | undefined)?.["content-type"];
      return {
        data: new Uint8Array(Buffer.concat(chunks)),
        ...(typeof type === "string" ? { contentType: type } : {}),
      };
    },
  };
}

/** Checks App ID and Secret by asking for a tenant access token. */
export async function verifyCredentials(creds: FeishuCredentials): Promise<void> {
  const res = await fetch(
    `${openApiBase(creds.brand)}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: creds.appId, app_secret: creds.appSecret }),
    },
  );
  const body = (await res.json()) as ApiResult;
  if (body.code !== 0)
    throw new Error(`feishu credentials rejected: ${body.code} ${body.msg ?? ""}`.trim());
}
