import type { ModelSettings, SecretStore } from "@agentherd/core";
import { describe, expect, it } from "vitest";
import {
  agentForModel,
  agentModelEnv,
  CODEX_KEY_ENV,
  isGptModel,
  modelChoices,
  modelEnvFor,
} from "../src/agent-models.ts";
import { PI_KEY_ENV, PI_MODEL_ENV, resolveModel } from "../src/models.ts";

const settings: ModelSettings = {
  services: [
    {
      id: "deepseek",
      name: "DeepSeek",
      kind: "builtin",
      provider: "deepseek",
      models: ["deepseek-v4-pro"],
    },
    {
      id: "anthropic",
      name: "Anthropic",
      kind: "builtin",
      provider: "anthropic",
      models: ["claude-sonnet-4-5"],
    },
    {
      id: "gw",
      name: "Gateway",
      kind: "openai-compatible",
      baseUrl: "https://gw.example/v1/",
      models: ["m1", "gpt-6.1-sol"],
    },
  ],
  roles: {},
};

function secrets(values: Record<string, string>): SecretStore {
  return { get: (k) => values[k], set() {}, delete() {} };
}

describe("agent models", () => {
  it("lists which agents can run each model", () => {
    const choices = modelChoices(settings, ["dsh", "pi", "codex"]);
    expect(choices).toEqual([
      { ref: "deepseek/deepseek-v4-pro", agents: ["pi"] },
      { ref: "anthropic/claude-sonnet-4-5", agents: ["pi"] },
      { ref: "gw/m1", agents: ["pi"] },
      { ref: "gw/gpt-6.1-sol", agents: ["pi", "codex"] },
    ]);
  });

  it("knows GPT models and gives them to Codex, the rest to Pi (ADR 0031)", () => {
    for (const id of ["gpt-6.1-sol", "openai/gpt-5.5", "o3", "o4-mini", "codex-mini", "GPT-4o"]) {
      expect(isGptModel(id)).toBe(true);
    }
    for (const id of ["deepseek-v4-pro", "claude-opus-5-5", "glm-5.3", "gemini-pro", "kimi-k3"]) {
      expect(isGptModel(id)).toBe(false);
    }
    expect(agentForModel("gw/gpt-6.1-sol", ["dsh", "pi", "codex"])).toBe("codex");
    expect(agentForModel("gw/gpt-6.1-sol", ["dsh", "pi"])).toBe("pi");
    expect(agentForModel("deepseek/deepseek-v4-pro", ["pi", "codex"])).toBe("pi");
    expect(agentForModel(undefined, ["dsh", "pi", "codex"])).toBe("pi");
    expect(() => agentForModel(undefined, [])).toThrow(/no agent/);
  });

  it("builds the env of each agent, with the key in its own variable", () => {
    const gw = settings.services[2];
    if (gw === undefined) throw new Error("no service");
    const model = resolveModel(gw, "m1");
    const pi = agentModelEnv("pi", model, "k1");
    expect(JSON.parse(pi?.[PI_MODEL_ENV] ?? "{}").id).toBe("m1");
    expect(pi?.[PI_KEY_ENV]).toBe("k1");
    expect(agentModelEnv("codex", model, "k1")).toBeUndefined();
    const codex = agentModelEnv("codex", resolveModel(gw, "gpt-6.1-sol"), "k1");
    const config = JSON.parse(codex?.CODEX_CONFIG ?? "{}");
    expect(config).toEqual({
      model: "gpt-6.1-sol",
      model_provider: "agentherd",
      model_providers: {
        agentherd: {
          name: "AgentHerd",
          base_url: "https://gw.example/v1",
          env_key: CODEX_KEY_ENV,
          wire_api: "responses",
        },
      },
    });
    expect(codex?.MODEL_PROVIDER).toBe("agentherd");
    expect(codex?.CODEX_CONFIG).not.toContain("k1");
    expect(codex?.[CODEX_KEY_ENV]).toBe("k1");
    expect(agentModelEnv("dsh", model, "k1")).toBeUndefined();
  });

  it("modelEnvFor needs a listed model, a key and an agent that can run it", () => {
    const store = secrets({ "model:anthropic": "sk-a" });
    expect(modelEnvFor(settings, store, "pi", "anthropic/claude-sonnet-4-5", {})).toMatchObject({
      [PI_KEY_ENV]: "sk-a",
    });
    expect(() => modelEnvFor(settings, store, "pi", "anthropic/other", {})).toThrow(
      /not in the model list/,
    );
    expect(() => modelEnvFor(settings, store, "pi", "deepseek/deepseek-v4-pro", {})).toThrow(
      /no key for service "deepseek"/,
    );
    expect(() => modelEnvFor(settings, store, "codex", "anthropic/claude-sonnet-4-5", {})).toThrow(
      /cannot run/,
    );
  });
});
