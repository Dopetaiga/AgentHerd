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
    expect(options.addons).toEqual({
      scopes: { tenant: SCOPES },
      events: { items: { tenant: EVENTS } },
      callbacks: { items: CALLBACKS },
    });
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
