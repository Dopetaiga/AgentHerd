import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FakeChannel } from "@agentherd/channel-fake";
import type { SecretStore } from "@agentherd/core";
import { describe, expect, it } from "vitest";
import { writeConfig } from "../src/config.ts";
import { Host } from "../src/host.ts";
import { readPiDesktop, readPiDesktopSecret, serviceIdFor } from "../src/import-pi-desktop.ts";

interface Row {
  name: string;
  vendor: string;
  api: string;
  url: string;
  models: string[];
  key?: string;
  auth?: string;
  enabled?: number;
}

/** Writes a PI-Desktop data folder the way crates/host-core/src/secrets.rs does. */
function fakePiDesktop(dir: string, rows: Row[]): void {
  mkdirSync(join(dir, "secrets"), { recursive: true });
  const machineKey = randomBytes(32);
  writeFileSync(join(dir, "secrets", ".machine-key"), machineKey);
  const db = new DatabaseSync(join(dir, "pi.sqlite"));
  db.exec(`create table providers (id text, name text, vendor_key text, type text, api_style text,
    auth_kind text, base_url text, enabled integer, secret_ref text, config_json text, created_at integer)`);
  const insert = db.prepare("insert into providers values (?,?,?,?,?,?,?,?,?,?,?)");
  rows.forEach((r, i) => {
    const id = `p${i}`;
    const ref = r.key === undefined ? null : `secret:provider:${id}:api_key`;
    if (ref !== null && r.key !== undefined) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", machineKey, nonce);
      const data = Buffer.concat([
        cipher.update(r.key, "utf8"),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      const file = createHash("sha256").update(ref).digest("hex");
      writeFileSync(
        join(dir, "secrets", `${file}.bin`),
        Buffer.concat([nonce, data]).toString("base64"),
      );
    }
    const config = JSON.stringify({ models: r.models.map((m) => ({ id: m })) });
    insert.run(
      id,
      r.name,
      r.vendor,
      "custom",
      r.api,
      r.auth ?? "api_key",
      r.url,
      r.enabled ?? 1,
      ref,
      config,
      i,
    );
  });
  db.close();
}

const BUILTIN = { deepseek: "https://api.deepseek.com" };

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

describe("PI-Desktop import", () => {
  it("decrypts keys and maps services", () => {
    const dir = mkdtempSync(join(tmpdir(), "pid-"));
    fakePiDesktop(dir, [
      {
        name: "DeepSeek",
        vendor: "deepseek",
        api: "chat_completions",
        url: "https://api.deepseek.com",
        models: ["deepseek-flash"],
        key: "sk-1",
      },
      {
        name: "Anthropic",
        vendor: "custom",
        api: "anthropic_messages",
        url: "https://gw.example/",
        models: ["claude-opus-5-5"],
        key: "sk-2",
      },
      {
        name: "1",
        vendor: "custom",
        api: "chat_completions",
        url: "http://10.0.0.1:3000/api",
        models: ["gpt-6", "gpt-6"],
      },
      {
        name: "ChatGPT",
        vendor: "openai",
        api: "responses",
        url: "https://api.openai.com/v1",
        models: ["gpt-5"],
        auth: "oauth",
      },
      {
        name: "Off",
        vendor: "custom",
        api: "chat_completions",
        url: "https://off.example",
        models: ["x"],
        enabled: 0,
      },
      {
        name: "Odd",
        vendor: "custom",
        api: "responses",
        url: "https://odd.example",
        models: ["y"],
      },
    ]);
    const r = readPiDesktop(dir, { builtin: BUILTIN });
    expect(r.services).toEqual([
      {
        service: {
          id: "deepseek",
          name: "DeepSeek",
          kind: "builtin",
          provider: "deepseek",
          models: ["deepseek-flash"],
        },
        key: "sk-1",
      },
      {
        service: {
          id: "anthropic",
          name: "Anthropic",
          kind: "openai-compatible",
          baseUrl: "https://gw.example",
          models: ["claude-opus-5-5"],
          api: "anthropic-messages",
        },
        key: "sk-2",
      },
      {
        service: {
          id: "10-0-0-1",
          name: "1",
          kind: "openai-compatible",
          baseUrl: "http://10.0.0.1:3000/api",
          models: ["gpt-6"],
        },
      },
    ]);
    expect(r.skipped.map((s) => s.name)).toEqual(["ChatGPT", "Odd"]);
    expect(readPiDesktopSecret(dir, "secret:provider:nope:api_key")).toBeUndefined();
  });

  it("keeps ids unique", () => {
    const taken = new Set(["site"]);
    expect(serviceIdFor("site", undefined, taken)).toBe("site-2");
    expect(serviceIdFor("网关", "https://ai.example.com/v1", taken)).toBe("ai-example-com");
  });

  it("merges into the list through the host without losing existing keys", async () => {
    const home = mkdtempSync(join(tmpdir(), "ah-"));
    fakePiDesktop(join(home, ".pi-desktop"), [
      {
        name: "DeepSeek",
        vendor: "deepseek",
        api: "chat_completions",
        url: "https://api.deepseek.com",
        models: ["deepseek-v4-pro"],
        key: "sk-new",
      },
      {
        name: "site",
        vendor: "custom",
        api: "chat_completions",
        url: "https://ai.example",
        models: ["gpt-6"],
        key: "sk-site",
      },
    ]);
    writeConfig(home, {
      models: {
        services: [
          {
            id: "deepseek",
            name: "DeepSeek",
            kind: "builtin",
            provider: "deepseek",
            models: ["deepseek-flash"],
          },
        ],
        roles: {},
      },
    });
    const secrets = memorySecrets();
    secrets.set("model:deepseek", "sk-old");
    const host = new Host({
      home,
      userHome: home,
      secrets,
      env: {},
      profiles: () => [],
      createChannel: () => new FakeChannel(),
    });
    try {
      const r = await host.importPiDesktop();
      expect(r.added).toEqual(["site"]);
      expect(r.merged).toEqual(["DeepSeek"]);
      const deepseek = r.models.services.find((s) => s.id === "deepseek");
      expect(deepseek?.models).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
      expect(secrets.saved["model:deepseek"]).toBe("sk-old");
      expect(secrets.saved["model:site"]).toBe("sk-site");
    } finally {
      await host.stop();
    }
  });
});
