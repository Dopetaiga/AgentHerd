// Builds the Herder from config.json and the model key (plan 009). The key comes from the
// provider's environment variable (DEEPSEEK_API_KEY, ...) or from the keychain, never from chat.

import type { HerderFactory } from "@agentherd/core";
import { Herder } from "@agentherd/herder";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getEnvApiKey, getModel, streamSimple } from "@earendil-works/pi-ai/compat";

export interface HerderConfig {
  /** pi-ai provider id. Default: deepseek. */
  provider?: string;
  /** Model id of that provider. Default: deepseek-flash. */
  model?: string;
}

export const DEFAULT_HERDER = { provider: "deepseek", model: "deepseek-flash" } as const;

export type KeySource = "env" | "keychain";

export interface HerderSetup {
  factory: HerderFactory;
  provider: string;
  model: string;
  keySource: KeySource;
}

/**
 * Returns the factory, or a reason why there is no Herder. `keychainKey` reads the saved key.
 */
export function herderSetup(
  config: HerderConfig | undefined,
  keychainKey: (provider: string) => string | undefined,
  env: Record<string, string | undefined> = process.env,
): HerderSetup | { reason: string } {
  const provider = config?.provider ?? DEFAULT_HERDER.provider;
  const modelId = config?.model ?? DEFAULT_HERDER.model;
  const model = (getModel as (p: string, m: string) => Model<Api> | undefined)(provider, modelId);
  if (model === undefined) return { reason: `unknown Herder model ${provider}/${modelId}` };
  const envKey = getEnvApiKey(provider, definedOnly(env));
  const key = envKey ?? keychainKey(provider);
  if (key === undefined || key === "") {
    return {
      reason: `no key for ${provider}: set its environment variable or run "agentherd setup herder"`,
    };
  }
  return {
    provider,
    model: modelId,
    keySource: envKey === undefined ? "keychain" : "env",
    factory: (host) => new Herder({ host, model, streamFn: streamSimple, getApiKey: () => key }),
  };
}

function definedOnly(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  return out;
}
