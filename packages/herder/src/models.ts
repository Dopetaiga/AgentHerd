// Turns the owner's model choice (packages/core/src/models.ts, ADR 0021) into a pi-ai model, lists
// the providers pi-ai knows, and tests a service with one short request.

import type { HerderFactory, ModelService, ModelSettings, SecretStore } from "@agentherd/core";
import { modelFor, modelKeyAccount } from "@agentherd/core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  completeSimple,
  getEnvApiKey,
  getModels,
  getProviders,
  streamSimple,
} from "@earendil-works/pi-ai/compat";
import { Herder } from "./herder.ts";

/** pi-ai providers that need more than one key (cloud credentials, OAuth or an account id). */
const NOT_KEY_ONLY = new Set([
  "amazon-bedrock",
  "azure",
  "google-vertex",
  "cloudflare-ai-gateway",
  "cloudflare-workers-ai",
  "github-copilot",
  "openai-codex",
]);

export interface BuiltinProvider {
  provider: string;
  models: { id: string; name: string }[];
}

/** Providers that need only a key, with their models, from pi-ai's catalog. */
export function builtinProviders(): BuiltinProvider[] {
  return (getProviders() as string[])
    .filter((p) => !NOT_KEY_ONLY.has(p))
    .map((provider) => ({
      provider,
      models: (getModels as (p: string) => Model<Api>[])(provider)
        .filter((m) => m.type === undefined || m.type === "chat")
        .map((m) => ({ id: m.id, name: m.name })),
    }))
    .filter((p) => p.models.length > 0);
}

/** Values for a model id pi-ai does not know (pi-desktop uses the same, ADR 0114). */
export const CUSTOM_CONTEXT_WINDOW = 128_000;
export const CUSTOM_MAX_TOKENS = 8_192;

export function resolveModel(service: ModelService, modelId: string): Model<Api> {
  if (service.kind === "builtin") {
    const provider = service.provider ?? "";
    const known = (getModels as (p: string) => Model<Api>[])(provider);
    const model = known.find((m) => m.id === modelId);
    if (model !== undefined) return model;
    const base = known[0];
    if (base === undefined) throw new Error(`pi-ai does not know provider "${provider}"`);
    // A new model of a known provider: same endpoint and API, default limits.
    return { ...base, id: modelId, name: modelId, reasoning: false, thinkingLevelMap: undefined };
  }
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: service.id,
    baseUrl: (service.baseUrl ?? "").replace(/\/+$/, ""),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: CUSTOM_CONTEXT_WINDOW,
    maxTokens: CUSTOM_MAX_TOKENS,
  };
}

/** The key of a service: the secret store first, then the provider's environment variable. */
export function serviceKey(
  service: ModelService,
  secrets: SecretStore,
  env: Record<string, string> = definedEnv(),
): string | undefined {
  const saved = secrets.get(modelKeyAccount(service.id));
  if (saved !== undefined && saved !== "") return saved;
  if (service.kind === "builtin" && service.provider !== undefined) {
    return getEnvApiKey(service.provider, env) ?? undefined;
  }
  return undefined;
}

export type TestResult = { ok: true; reply: string } | { ok: false; message: string };

export const TEST_TIMEOUT_MS = 30_000;

/** Sends one short request. */
export async function testModel(
  model: Model<Api>,
  key: string | undefined,
  timeoutMs = TEST_TIMEOUT_MS,
): Promise<TestResult> {
  try {
    const reply = await completeSimple(
      model,
      { messages: [{ role: "user", content: "Reply with the word OK.", timestamp: Date.now() }] },
      { apiKey: key ?? "none", signal: AbortSignal.timeout(timeoutMs) },
    );
    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      return { ok: false, message: reply.errorMessage ?? reply.stopReason };
    }
    const text = reply.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("")
      .trim();
    return { ok: true, reply: text.slice(0, 200) };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

export interface HerderChoice {
  factory: HerderFactory;
  ref: string;
}

/** The Herder for the chosen model, or why there is none. */
export function herderFromSettings(
  settings: ModelSettings,
  secrets: SecretStore,
  env?: Record<string, string>,
): HerderChoice | { reason: string } {
  const choice = modelFor(settings, "herder");
  if (choice === undefined) return { reason: "no model chosen for the Herder" };
  let model: Model<Api>;
  try {
    model = resolveModel(choice.service, choice.model);
  } catch (error) {
    return { reason: (error as Error).message };
  }
  const key = serviceKey(choice.service, secrets, env);
  if (key === undefined && choice.service.kind === "builtin") {
    return { reason: `no key for service "${choice.service.id}"` };
  }
  return {
    ref: `${choice.service.id}/${choice.model}`,
    factory: (host) =>
      new Herder({ host, model, streamFn: streamSimple, getApiKey: () => key ?? "none" }),
  };
}

function definedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) out[k] = v;
  return out;
}
