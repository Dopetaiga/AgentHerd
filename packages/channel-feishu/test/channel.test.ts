import type { SetupUI } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import type { FeishuApi, FeishuCredentials } from "../src/api.ts";
import { CALLBACKS, EVENTS, FeishuChannel, SCOPES } from "../src/channel.ts";

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
