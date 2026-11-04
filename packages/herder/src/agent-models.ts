// Which models from the owner's list each agent can run, and the env that makes it run one
// (ADR 0025). The Herder picks a model per task; the agent gets it through env, never through
// its command line, so the key stays out of `ps`.

import type { ModelService, ModelSettings, SecretStore } from "@agentherd/core";
import { parseModelRef } from "@agentherd/core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { PI_KEY_ENV, PI_MODEL_ENV, resolveModel, serviceKey } from "./models.ts";

/** Env names for agents that read the key from a variable named in their config. */
export const OPENCODE_KEY_ENV = "AGENTHERD_OPENCODE_KEY";
export const OPENCODE_PROVIDER = "agentherd";

/**
 * The env that makes an agent use a model, or `undefined` when the agent cannot use it.
 * - pi: any pi-ai model, through the bridge's model extension (verified with Pi 1.5.0).
 * - opencode: OpenAI-compatible endpoints, as a custom provider in `OPENCODE_CONFIG_CONTENT`.
 * - claude: Anthropic-format endpoints, through `ANTHROPIC_BASE_URL` and `ANTHROPIC_MODEL`.
 * - gemini: Google's Gemini API, through `GEMINI_API_KEY` and `GEMINI_MODEL`.
 * DSH and Codex keep their own settings.
 */
export function agentModelEnv(
  agentId: string,
  model: Model<Api>,
  key: string | undefined,
): Record<string, string> | undefined {
  switch (agentId) {
    case "pi":
      return { [PI_MODEL_ENV]: JSON.stringify(model), [PI_KEY_ENV]: key ?? "none" };
    case "opencode":
      if (model.api !== "openai-completions") return undefined;
      return {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          provider: {
            [OPENCODE_PROVIDER]: {
              npm: "@ai-sdk/openai-compatible",
              name: "AgentHerd",
              options: { baseURL: model.baseUrl, apiKey: `{env:${OPENCODE_KEY_ENV}}` },
              models: { [model.id]: { name: model.name } },
            },
          },
          model: `${OPENCODE_PROVIDER}/${model.id}`,
        }),
        [OPENCODE_KEY_ENV]: key ?? "none",
      };
    case "claude":
      if (model.api !== "anthropic-messages" || key === undefined) return undefined;
      return {
        ANTHROPIC_BASE_URL: model.baseUrl,
        ANTHROPIC_API_KEY: key,
        ANTHROPIC_MODEL: model.id,
        ANTHROPIC_SMALL_FAST_MODEL: model.id,
      };
    case "gemini":
      if (model.api !== "google-generative-ai" || key === undefined) return undefined;
      return { GEMINI_API_KEY: key, GEMINI_MODEL: model.id };
    default:
      return undefined;
  }
}

export interface ModelChoice {
  /** "service/model" */
  ref: string;
  /** Profile ids that can run this model. */
  agents: string[];
}

function resolved(service: ModelService, id: string): Model<Api> | undefined {
  try {
    return resolveModel(service, id);
  } catch {
    return undefined;
  }
}

/** Every model in the owner's list, with the agents (of `agentIds`) that can run it. */
export function modelChoices(settings: ModelSettings, agentIds: string[]): ModelChoice[] {
  const out: ModelChoice[] = [];
  for (const service of settings.services) {
    for (const id of service.models) {
      const model = resolved(service, id);
      if (model === undefined) continue;
      // The key does not change which agents can use a model; a placeholder is enough here.
      const agents = agentIds.filter((a) => agentModelEnv(a, model, "key") !== undefined);
      out.push({ ref: `${service.id}/${id}`, agents });
    }
  }
  return out;
}

/**
 * The env for running `agentId` with the model `ref` ("service/model").
 * @throws When the model is not in the list, has no key, or the agent cannot run it.
 */
export function modelEnvFor(
  settings: ModelSettings,
  secrets: SecretStore,
  agentId: string,
  ref: string,
  env?: Record<string, string>,
): Record<string, string> {
  const { serviceId, model: id } = parseModelRef(ref);
  const service = settings.services.find((s) => s.id === serviceId);
  if (service === undefined || !service.models.includes(id)) {
    throw new Error(`model "${ref}" is not in the model list`);
  }
  const model = resolveModel(service, id);
  const key = serviceKey(service, secrets, env);
  if (key === undefined && service.kind === "builtin") {
    throw new Error(`no key for service "${service.id}"`);
  }
  const out = agentModelEnv(agentId, model, key);
  if (out === undefined) throw new Error(`agent "${agentId}" cannot run model "${ref}"`);
  return out;
}
