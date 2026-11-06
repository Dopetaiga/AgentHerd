import type { Inbound, SetupUI } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import type { FeishuApi, FeishuCredentials } from "../src/api.ts";
import { CALLBACKS, EVENTS, FeishuChannel, imageType, SCOPES } from "../src/channel.ts";

function ui() {
  const states: string[] = [];
  const qrs: [string, number][] = [];
  const setupUi: SetupUI = {
    showQrCode: (url, s) => qrs.push([url, s]),
    showStatus: (s) => states.push(s),
  };
  return { setupUi, states, qrs };
}

describe("FeishuChannel.setup", () => {
  it("creates the app with one scan, verifies, stores the secret outside the binding", async () => {
    const saved: [string, string][] = [];
    const verified: FeishuCredentials[] = [];
    let options: Record<string, unknown> = {};
    const channel = new FeishuChannel({
      getSecret: async () => "",
      saveSecret: async (id, secret) => {
        saved.push([id, secret]);
      },
      verify: async (c) => {
        verified.push(c);
      },
      register: (async (
        opts: Record<string, unknown> & { onQRCodeReady: (i: unknown) => void },
      ) => {
        options = opts;
        opts.onQRCodeReady({ url: "https://open.feishu.cn/qr", expireIn: 3600 });
        return {
          client_id: "cli_1",
          client_secret: "s3cret-value",
          user_info: { open_id: "ou_owner", tenant_brand: "feishu" },
        };
      }) as never,
    });
    const { setupUi, states, qrs } = ui();
    const binding = await channel.setup(setupUi);

    expect(binding).toEqual({
      channelId: "feishu",
      ownerId: "ou_owner",
      data: { appId: "cli_1", brand: "feishu" },
    });
    expect(JSON.stringify(binding)).not.toContain("s3cret-value");
    expect(saved).toEqual([["cli_1", "s3cret-value"]]);
    expect(verified[0]?.appSecret).toBe("s3cret-value");
    expect(qrs).toEqual([["https://open.feishu.cn/qr", 3600]]);
    expect(states).toEqual(["waiting-scan", "verifying", "connected"]);
    expect(options.createOnly).toBe(true);
    expect(options.appPreset).toEqual({
      name: "AgentHerd",
      desc: "只在你的 Agent 需要你时才打扰你",
    });
    expect(options.addons).toEqual({
      scopes: { tenant: SCOPES },
      events: { items: { tenant: EVENTS } },
      callbacks: { items: CALLBACKS },
    });
  });

  it("keeps waiting for the scan while Feishu answers authorization_pending", async () => {
    const channel = new FeishuChannel({
      getSecret: async () => "",
      saveSecret: async () => {},
      verify: async () => {},
      register: (async (
        opts: Record<string, unknown> & {
          onQRCodeReady: (i: unknown) => void;
          onStatusChange?: (i: unknown) => void;
        },
      ) => {
        opts.onQRCodeReady({ url: "https://open.feishu.cn/qr", expireIn: 600 });
        // The SDK reports "polling" for every authorization_pending answer, scanned or not.
        opts.onStatusChange?.({ status: "polling" });
        opts.onStatusChange?.({ status: "slow_down", interval: 10 });
        return { client_id: "cli_1", client_secret: "x", user_info: { open_id: "ou" } };
      }) as never,
    });
    const { setupUi, states } = ui();
    await channel.setup(setupUi);
    expect(states).toEqual(["waiting-scan", "verifying", "connected"]);
  });

  it("does not store the secret when verification fails", async () => {
    const saved: string[] = [];
    const channel = new FeishuChannel({
      getSecret: async () => "",
      saveSecret: async (id) => {
        saved.push(id);
      },
      verify: async () => {
        throw new Error("feishu credentials rejected: 10014 app secret invalid");
      },
      register: (async () => ({
        client_id: "cli_1",
        client_secret: "x",
        user_info: { open_id: "ou" },
      })) as never,
    });
    await expect(channel.setup(ui().setupUi)).rejects.toThrow("rejected");
    expect(saved).toEqual([]);
  });
});

describe("FeishuChannel.start", () => {
  it("reads the secret by App ID and never throws back into Feishu", async () => {
    let creds: FeishuCredentials | null = null;
    let onCardAction: ((p: unknown) => Promise<Record<string, unknown>>) | null = null;
    const errors: string[] = [];
    const api: FeishuApi = {
      connect: async (h) => {
        onCardAction = h.onCardAction;
      },
      close: async () => {},
      sendCard: async () => "om_1",
      patchCard: async () => {},
      pin: async () => {},
      downloadImage: async () => ({ data: new Uint8Array() }),
      downloadFile: async () => ({ data: new Uint8Array() }),
    };
    const channel = new FeishuChannel({
      getSecret: async (appId) => `secret-for-${appId}`,
      saveSecret: async () => {},
      createApi: (c) => {
        creds = c;
        return api;
      },
      onError: (e) => errors.push(e.message),
      locale: "en",
    });
    await channel.start(
      { channelId: "feishu", ownerId: "ou_owner", data: { appId: "cli_9", brand: "lark" } },
      () => {
        throw new Error("sink failed");
      },
    );
    expect(creds).toEqual({ appId: "cli_9", appSecret: "secret-for-cli_9", brand: "lark" });
    const handler = onCardAction as unknown as (p: unknown) => Promise<Record<string, unknown>>;
    const response = await handler({
      operator: { open_id: "ou_owner" },
      action: { value: { target: "i1", action: "allow" } },
    });
    expect(response).toEqual({ toast: { type: "info", content: "Received" } });
    await new Promise((r) => setTimeout(r, 5));
    expect(errors).toEqual(["sink failed"]);
  });

  it("refuses a binding without an App ID", async () => {
    const channel = new FeishuChannel({ getSecret: async () => "", saveSecret: async () => {} });
    await expect(
      channel.start({ channelId: "feishu", ownerId: "ou", data: {} }, () => {}),
    ).rejects.toThrow("no appId");
  });
});

describe("FeishuChannel card callback", () => {
  it("returns the updated card in the callback response instead of patching", async () => {
    let onCardAction: ((p: unknown) => Promise<Record<string, unknown>>) | null = null;
    const patched: string[] = [];
    const api: FeishuApi = {
      connect: async (h) => {
        onCardAction = h.onCardAction;
      },
      close: async () => {},
      sendCard: async () => "om_1",
      patchCard: async (id) => {
        patched.push(id);
      },
      pin: async () => {},
      downloadImage: async () => ({ data: new Uint8Array() }),
      downloadFile: async () => ({ data: new Uint8Array() }),
    };
    const channel = new FeishuChannel({
      getSecret: async () => "s",
      saveSecret: async () => {},
      createApi: () => api,
    });
    await channel.start(
      { channelId: "feishu", ownerId: "ou_owner", data: { appId: "cli_1" } },
      async (inbound) => {
        if (inbound.kind === "action") {
          await channel.update(
            { channelId: "feishu", id: "om_1" },
            {
              kind: "item",
              itemId: "i1",
              title: "t",
              body: "b",
              risk: "low",
              options: [],
              final: "Allowed by you",
            },
          );
        }
      },
    );
    const handler = onCardAction as unknown as (p: unknown) => Promise<Record<string, unknown>>;
    const response = await handler({
      operator: { open_id: "ou_owner" },
      action: { value: { target: "i1", action: "allow" } },
      context: { open_message_id: "om_1" },
    });
    expect(patched).toEqual([]);
    expect(JSON.stringify(response.card)).toContain("Allowed by you");
    // After the callback is answered, updates patch again.
    await channel.update({ channelId: "feishu", id: "om_1" }, { kind: "text", text: "later" });
    expect(patched).toEqual(["om_1"]);
  });
});

describe("FeishuChannel locale", () => {
  it("toasts in Chinese by default", async () => {
    let onCardAction: ((p: unknown) => Promise<Record<string, unknown>>) | null = null;
    const api: FeishuApi = {
      connect: async (h) => {
        onCardAction = h.onCardAction;
      },
      close: async () => {},
      sendCard: async () => "om_1",
      patchCard: async () => {},
      pin: async () => {},
      downloadImage: async () => ({ data: new Uint8Array() }),
      downloadFile: async () => ({ data: new Uint8Array() }),
    };
    const channel = new FeishuChannel({
      getSecret: async () => "s",
      saveSecret: async () => {},
      createApi: () => api,
    });
    await channel.start(
      { channelId: "feishu", ownerId: "ou_owner", data: { appId: "cli_1" } },
      () => {},
    );
    const handler = onCardAction as unknown as (p: unknown) => Promise<Record<string, unknown>>;
    const response = await handler({
      operator: { open_id: "ou_owner" },
      action: { value: { target: "i1", action: "allow" } },
    });
    expect(response).toEqual({ toast: { type: "info", content: "已收到" } });
  });

  it("uses the English app description with locale en", async () => {
    let options: Record<string, unknown> = {};
    const channel = new FeishuChannel({
      getSecret: async () => "",
      saveSecret: async () => {},
      verify: async () => {},
      locale: "en",
      register: (async (
        opts: Record<string, unknown> & { onQRCodeReady: (i: unknown) => void },
      ) => {
        options = opts;
        opts.onQRCodeReady({ url: "u", expireIn: 1 });
        return {
          client_id: "cli_1",
          client_secret: "s",
          user_info: { open_id: "ou_owner", tenant_brand: "feishu" },
        };
      }) as never,
    });
    await channel.setup(ui().setupUi);
    expect(options.appPreset).toEqual({
      name: "AgentHerd",
      desc: "Only pings you when your agents need you",
    });
  });
});

describe("FeishuChannel images", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);

  async function receive(
    payload: unknown,
    download: FeishuApi["downloadImage"],
    downloadFile: FeishuApi["downloadFile"] = async () => ({ data: new Uint8Array() }),
  ) {
    let onMessage: ((p: unknown) => Promise<void>) | null = null;
    const got: Inbound[] = [];
    const channel = new FeishuChannel({
      getSecret: async () => "s",
      saveSecret: async () => {},
      createApi: () => ({
        connect: async (h) => {
          onMessage = h.onMessage;
        },
        close: async () => {},
        sendCard: async () => "om_1",
        patchCard: async () => {},
        pin: async () => {},
        downloadImage: download,
        downloadFile,
      }),
    });
    await channel.start(
      { channelId: "feishu", ownerId: "ou_owner", data: { appId: "cli_1" } },
      (inbound) => {
        got.push(inbound);
      },
    );
    await (onMessage as unknown as (p: unknown) => Promise<void>)(payload);
    return got;
  }

  const image = {
    sender: { sender_id: { open_id: "ou_owner" }, sender_type: "user" },
    message: {
      message_id: "om_9",
      chat_type: "p2p",
      message_type: "image",
      content: JSON.stringify({ image_key: "img_9" }),
    },
  };

  it("downloads the image of a message and passes it on", async () => {
    const asked: string[] = [];
    const got = await receive(image, async (id, key) => {
      asked.push(`${id}/${key}`);
      return { data: PNG, contentType: "application/octet-stream" };
    });
    expect(asked).toEqual(["om_9/img_9"]);
    expect(got).toEqual([
      {
        kind: "message",
        text: "",
        from: "ou_owner",
        images: [{ mimeType: "image/png", data: PNG }],
      },
    ]);
  });

  it("says so in the text when an image cannot be downloaded", async () => {
    const got = await receive(image, async () => {
      throw new Error("234043");
    });
    expect(got).toEqual([{ kind: "message", text: "[图片没能下载：234043]", from: "ou_owner" }]);
  });

  const file = (type: string, content: object) => ({
    sender: { sender_id: { open_id: "ou_owner" }, sender_type: "user" },
    message: {
      message_id: "om_7",
      chat_type: "p2p",
      message_type: type,
      content: JSON.stringify(content),
    },
  });

  it("downloads a file message and passes it on with its name", async () => {
    const asked: string[] = [];
    const data = new Uint8Array([1, 2, 3]);
    const got = await receive(
      file("file", { file_key: "file_7", file_name: "报告.pdf" }),
      async () => ({ data: PNG }),
      async (id, key) => {
        asked.push(`${id}/${key}`);
        return { data };
      },
    );
    expect(asked).toEqual(["om_7/file_7"]);
    expect(got).toEqual([
      { kind: "message", text: "", from: "ou_owner", files: [{ name: "报告.pdf", data }] },
    ]);
  });

  it("names a voice message after its key and notes a failed file download", async () => {
    const voice = await receive(
      file("audio", { file_key: "file_v", duration: 3000 }),
      async () => ({ data: PNG }),
      async () => ({ data: PNG }),
    );
    expect(voice[0]).toMatchObject({ files: [{ name: "file_v.opus" }] });
    const failed = await receive(
      file("media", { file_key: "file_m", file_name: "a.mp4", image_key: "img_m" }),
      async () => ({ data: PNG }),
      async () => {
        throw new Error("too big");
      },
    );
    expect(failed).toEqual([
      { kind: "message", text: "[文件 a.mp4 没能下载：too big]", from: "ou_owner" },
    ]);
  });

  it("tells image types by their first bytes", () => {
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toBe("image/jpeg");
    expect(imageType(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe("image/gif");
    expect(imageType(new Uint8Array([1]), "image/heic")).toBe("image/heic");
    expect(imageType(new Uint8Array([1]))).toBe("image/png");
  });
});
