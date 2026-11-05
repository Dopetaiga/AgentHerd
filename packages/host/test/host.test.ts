import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel } from "@agentherd/channel-fake";
import type { SecretStore } from "@agentherd/core";
import { afterEach, describe, expect, it } from "vitest";
import type { HostEvent } from "../src/api.ts";
import { readConfig, writeConfig } from "../src/config.ts";
import { Host } from "../src/host.ts";
import { connectHost, isHostRunning, serveApi, socketPath } from "../src/server.ts";

function memorySecrets(): SecretStore & { saved: Record<string, string> } {
  const saved: Record<string, string> = {};
  return {
    saved,
    get: (a) => saved[a],
    set: (a, v) => {
      saved[a] = v;
    },
    delete: (a) => {
      delete saved[a];
    },
  };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function makeHost(bound = false) {
  // Short path: Unix socket paths are limited to about 104 bytes on macOS.
  const home = mkdtempSync(join(tmpdir(), "ah-"));
  if (bound) writeConfig(home, { channel: { channelId: "fake", ownerId: "owner", data: {} } });
  const secrets = memorySecrets();
  const channels: FakeChannel[] = [];
  const events: HostEvent[] = [];
  const host = new Host({
    home,
    userHome: home,
    secrets,
    env: {},
    profiles: () => [],
    createChannel: () => {
      const c = new FakeChannel();
      channels.push(c);
      return c;
    },
  });
  host.onEvent((e) => events.push(e));
  cleanups.push(() => host.stop());
  return { home, host, secrets, channels, events };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

describe("Host", () => {
  it("starts without a channel and reports why the Herder is off", async () => {
    const t = makeHost();
    await t.host.start();
    const s = t.host.status();
    expect(s.channel).toEqual({ bound: false, connected: false });
    expect(s.herder).toEqual({ on: false, reason: "no model chosen for the Herder" });
    expect(s.mode).toBe("assist");
    expect(t.host.tasks()).toEqual({ tasks: [], items: [] });
  });

  it("binds the channel through setup and connects", async () => {
    const t = makeHost();
    await t.host.start();
    expect(t.host.setupFeishu().phase).toBe("starting");
    await until(() => t.host.status().channel.connected);
    expect(readConfig(t.home).channel?.channelId).toBe("fake");
    expect(t.host.setupState().phase).toBe("connected");
    expect(t.events.some((e) => e.topic === "setup" && e.data.phase === "connected")).toBe(true);
  });

  it("keeps model keys out of config.json and turns the Herder on and off", async () => {
    const t = makeHost(true);
    await t.host.start();
    expect(t.host.status().channel.connected).toBe(true);
    await t.host.putService(
      {
        id: "deepseek",
        name: "DeepSeek",
        kind: "builtin",
        provider: "deepseek",
        models: ["deepseek-flash"],
      },
      "sk-secret",
    );
    expect(t.host.models().services[0]?.hasKey).toBe(true);
    await t.host.chooseModel("herder", { serviceId: "deepseek", model: "deepseek-flash" });
    expect(t.host.status().herder).toEqual({ on: true, ref: "deepseek/deepseek-flash" });
    expect(readFileSync(join(t.home, "config.json"), "utf8")).not.toContain("sk-secret");
    expect(t.secrets.saved).toEqual({ "model:deepseek": "sk-secret" });

    await t.host.chooseModel("pi", { serviceId: "deepseek", model: "deepseek-flash" });
    expect(t.host.models().roles.pi).toEqual({ serviceId: "deepseek", model: "deepseek-flash" });

    await t.host.setKey("deepseek", "");
    expect(t.host.status().herder).toEqual({ on: false, reason: 'no key for service "deepseek"' });
    await t.host.removeService("deepseek");
    expect(t.host.models()).toEqual({ services: [], roles: {} });
    expect(t.events.some((e) => e.topic === "models")).toBe(true);
  });

  it("reconnects the channel on request", async () => {
    const t = makeHost(true);
    await t.host.start();
    expect((await t.host.reconnect()).channel.connected).toBe(true);
    expect(t.channels).toHaveLength(2);
  });

  it("changes the mode and keep-awake, refusing auto", async () => {
    const t = makeHost(true);
    await t.host.start();
    expect(t.host.updateSettings({ mode: "observe", keepAwake: true })).toMatchObject({
      mode: "observe",
      keepAwake: true,
    });
    expect(readConfig(t.home)).toMatchObject({ mode: "observe", keepAwake: true });
    expect(() => t.host.updateSettings({ mode: "auto" })).toThrow(/observe or assist/);
  });

  it("keeps the owner's model guide and goes back to the default", () => {
    const t = makeHost(false);
    const first = t.host.modelGuide();
    expect(first.custom).toBe(false);
    expect(first.text).toBe(first.defaultText);
    expect(first.text).toContain("Opus");
    expect(t.host.setModelGuide("  只用 DeepSeek  ")).toMatchObject({
      custom: true,
      text: "只用 DeepSeek",
    });
    expect(readConfig(t.home).modelGuide).toBe("只用 DeepSeek");
    expect(t.host.setModelGuide(null)).toMatchObject({ custom: false, text: first.defaultText });
    expect(readConfig(t.home).modelGuide).toBeUndefined();
    expect(t.host.setModelGuide(first.defaultText).custom).toBe(false);
  });
});

describe("local API socket", () => {
  it("answers calls, forwards events and refuses a second host", async () => {
    const t = makeHost();
    await t.host.start();
    const path = socketPath(t.home);
    const server = await serveApi(t.host, path);
    cleanups.unshift(() => server.close());
    expect(await isHostRunning(path)).toBe(true);
    await expect(serveApi(t.host, path)).rejects.toThrow(/another AgentHerd host/);

    const client = await connectHost(path);
    cleanups.unshift(async () => client.close());
    const events: HostEvent[] = [];
    client.onEvent((e) => events.push(e));
    expect((await client.host.status()).channel.bound).toBe(false);
    await client.host.putService({
      id: "local",
      name: "Ollama",
      kind: "openai-compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      models: ["qwen3"],
    });
    await until(() => events.some((e) => e.topic === "models"));
    // Editing a service without a new key: JSON sends the undefined key as null.
    await client.host.setKey("local", "sk-local");
    const edited = await client.host.putService(
      {
        id: "local",
        name: "Ollama 2",
        kind: "openai-compatible",
        baseUrl: "http://127.0.0.1:11434/v1",
        models: ["qwen3"],
      },
      undefined,
    );
    expect(edited.services.find((s) => s.id === "local")).toMatchObject({
      name: "Ollama 2",
      hasKey: true,
    });
    await expect(client.host.removeService("nope")).rejects.toThrow(/no service "nope"/);
    expect((await client.host.providers()).some((p) => p.provider === "deepseek")).toBe(true);
  });
});
