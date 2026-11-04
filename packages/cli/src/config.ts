// CLI configuration: `<home>/config.json` (no secrets, mode 600) and the App Secret in the
// macOS keychain.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentProfile, ChannelBinding, Locale, Mode } from "@agentherd/protocol";
import { Entry } from "@napi-rs/keyring";
import type { HerderConfig } from "./herder.ts";

export const KEYCHAIN_SERVICE = "agentherd";

export interface CliConfig {
  channel?: ChannelBinding;
  mode?: Mode;
  /** Language of channel texts: "zh-CN" (default) or "en". */
  locale?: Locale;
  /** Agent profiles in addition to the built-in `mock` profile. */
  profiles?: AgentProfile[];
  /** The Herder's model. The key is in the environment or the keychain. */
  herder?: HerderConfig;
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

function herderEntry(provider: string): Entry {
  return new Entry(KEYCHAIN_SERVICE, `herder:${provider}`);
}

export function saveHerderKey(provider: string, key: string): void {
  herderEntry(provider).setPassword(key);
}

export function getHerderKey(provider: string): string | undefined {
  try {
    return herderEntry(provider).getPassword() ?? undefined;
  } catch {
    return undefined;
  }
}
