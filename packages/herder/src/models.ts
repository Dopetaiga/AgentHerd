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
import { Herder, type HerderModel } from "./herder.ts";
import type { TierPlacement } from "./model-guide.ts";
import { fallbackOrder } from "./tools.ts";

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

/** Base URL of each key-only pi-ai provider, to recognise a service imported from elsewhere. */
export function builtinBaseUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of builtinProviders()) {
    const first = (getModels as (p: string) => Model<Api>[])(p.provider)[0];
    if (first !== undefined) out[p.provider] = first.baseUrl.replace(/\/+$/, "");
  }
  return out;
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
    api: service.api ?? "openai-completions",
    provider: service.id,
    baseUrl: (service.baseUrl ?? "").replace(/\/+$/, ""),
    reasoning: false,
    input: knownInput(modelId),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: CUSTOM_CONTEXT_WINDOW,
    maxTokens: CUSTOM_MAX_TOKENS,
  };
}

/**
 * What a model id reads, from pi-ai's catalog: a relay usually serves a model under its own
 * name (`gemini-3.8-flash`, `anthropic/claude-opus-5-5`). Unknown ids read text only, because
 * an image sent to a model without vision fails the whole request.
 */
export function knownInput(modelId: string): ("text" | "image")[] {
  const bare = modelId.slice(modelId.lastIndexOf("/") + 1);
  for (const provider of getProviders()) {
    for (const m of (getModels as (p: string) => Model<Api>[])(provider)) {
      const id = m.id.slice(m.id.lastIndexOf("/") + 1);
      if (id === bare && m.input.includes("image")) return ["text", "image"];
    }
  }
  return ["text"];
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
  modelTiers?: () => TierPlacement,
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
  const ref = `${choice.service.id}/${choice.model}`;
  return {
    ref,
    factory: (host) =>
      new Herder({
        host,
        model,
        modelRef: ref,
        streamFn: streamSimple,
        getApiKey: () => key ?? "none",
        fallbacks: () => herderFallbacks(settings, secrets, ref, modelTiers?.(), env),
        ...(modelTiers === undefined ? {} : { modelTiers }),
      }),
  };
}

/**
 * Models the Herder can switch to when its own keeps failing (ADR 0037), in the order tasks use:
 * the same model on other services, then its tier, then the other tiers. Models without a key are
 * left out.
 */
export function herderFallbacks(
  settings: ModelSettings,
  secrets: SecretStore,
  current: string,
  tiers?: TierPlacement,
  env?: Record<string, string>,
): HerderModel[] {
  const all = settings.services.flatMap((s) =>
    s.models.map((m) => ({ ref: `${s.id}/${m}`, agents: ["herder"], service: s, model: m })),
  );
  let order: string[];
  try {
    order = fallbackOrder(all, current, "herder", tiers);
  } catch {
    order = all.map((m) => m.ref);
  }
  for (const m of all) if (!order.includes(m.ref)) order.push(m.ref);
  const out: HerderModel[] = [];
  for (const ref of order) {
    if (ref === current) continue;
    const entry = all.find((m) => m.ref === ref);
    if (entry === undefined) continue;
    const key = serviceKey(entry.service, secrets, env);
    if (key === undefined && entry.service.kind === "builtin") continue;
    try {
      out.push({ ref, model: resolveModel(entry.service, entry.model), apiKey: key ?? "none" });
    } catch {
      // A model pi-ai cannot resolve is skipped.
    }
  }
  return out;
}

/** Env names the Pi bridge reads (packages/pi-acp/extension/model.ts). */
export const PI_MODEL_ENV = "AGENTHERD_PI_MODEL";
export const PI_KEY_ENV = "AGENTHERD_PI_KEY";

export type PiModelChoice = { env: Record<string, string>; ref: string } | { reason: string };

/**
 * The env that gives Pi sessions the model chosen for the `pi` role: the pi-ai model as JSON and
 * the key in a separate variable, so neither is on a command line.
 * @returns `{ reason }` when no model is chosen or it cannot be used; Pi then uses its own settings.
 */
export function piModelEnv(
  settings: ModelSettings,
  secrets: SecretStore,
  env?: Record<string, string>,
): PiModelChoice {
  const choice = modelFor(settings, "pi");
  if (choice === undefined) return { reason: "no model chosen for Pi; Pi uses its own settings" };
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
    env: { [PI_MODEL_ENV]: JSON.stringify(model), [PI_KEY_ENV]: key ?? "none" },
  };
}

function definedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) out[k] = v;
  return out;
}
