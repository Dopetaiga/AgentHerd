// Host configuration: `<home>/config.json` (no secrets, mode 600) and the App Secret in the
// macOS keychain.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelSettings, SecretStore } from "@agentherd/core";
import type { AgentProfile, ChannelBinding, Locale, Mode } from "@agentherd/protocol";
import { Entry } from "@napi-rs/keyring";

export const KEYCHAIN_SERVICE = "agentherd";

export interface CliConfig {
  channel?: ChannelBinding;
  mode?: Mode;
  /** Language of channel texts: "zh-CN" (default) or "en". */
  locale?: Locale;
  /** Agent profiles in addition to the built-in `mock` profile. */
  profiles?: AgentProfile[];
  /** Model services and the model of each role (ADR 0021). Keys are in the keychain. */
  models?: ModelSettings;
  /** Keep the Mac awake while tasks run (desktop app). */
  keepAwake?: boolean;
}

export function agentherdHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENTHERD_HOME ?? join(homedir(), ".agentherd");
}

export function configPath(home: string): string {
  return join(home, "config.json");
}

export function readConfig(home: string): CliConfig {
  const path = configPath(home);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as CliConfig;
}

export function writeConfig(home: string, config: CliConfig): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = configPath(home);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function keychainEntry(appId: string): Entry {
  return new Entry(KEYCHAIN_SERVICE, `feishu:${appId}`);
}

export async function saveSecret(appId: string, secret: string): Promise<void> {
  keychainEntry(appId).setPassword(secret);
}

export async function getSecret(appId: string): Promise<string> {
  const secret = keychainEntry(appId).getPassword();
  if (secret === null || secret === undefined || secret === "") {
    throw new Error(`no App Secret for ${appId} in the keychain; run "agentherd setup feishu"`);
  }
  return secret;
}

/** The macOS keychain, service "agentherd". */
export const keychain: SecretStore = {
  get(account) {
    try {
      return new Entry(KEYCHAIN_SERVICE, account).getPassword() ?? undefined;
    } catch {
      return undefined;
    }
  },
  set(account, value) {
    new Entry(KEYCHAIN_SERVICE, account).setPassword(value);
  },
  delete(account) {
    try {
      new Entry(KEYCHAIN_SERVICE, account).deletePassword();
    } catch {
      // Nothing saved.
    }
  },
};
