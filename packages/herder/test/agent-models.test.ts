import type { ModelSettings, SecretStore } from "@agentherd/core";
import { describe, expect, it } from "vitest";
import { agentModelEnv, modelChoices, modelEnvFor, OPENCODE_KEY_ENV } from "../src/agent-models.ts";
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
      models: ["m1"],
    },
  ],
  roles: {},
};

function secrets(values: Record<string, string>): SecretStore {
  return { get: (k) => values[k], set() {}, delete() {} };
}

describe("agent models", () => {
  it("lists which agents can run each model", () => {
    const choices = modelChoices(settings, ["dsh", "pi", "opencode", "claude", "gemini", "codex"]);
    expect(choices).toEqual([
      { ref: "deepseek/deepseek-v4-pro", agents: ["pi", "opencode"] },
      { ref: "anthropic/claude-sonnet-4-5", agents: ["pi", "claude"] },
      { ref: "gw/m1", agents: ["pi", "opencode"] },
    ]);
  });

  it("builds the env of each agent, with the key in its own variable", () => {
    const gw = settings.services[2];
    if (gw === undefined) throw new Error("no service");
    const model = resolveModel(gw, "m1");
    const pi = agentModelEnv("pi", model, "k1");
    expect(JSON.parse(pi?.[PI_MODEL_ENV] ?? "{}").id).toBe("m1");
    expect(pi?.[PI_KEY_ENV]).toBe("k1");
    const oc = agentModelEnv("opencode", model, "k1");
    const config = JSON.parse(oc?.OPENCODE_CONFIG_CONTENT ?? "{}");
    expect(config.model).toBe("agentherd/m1");
    expect(config.provider.agentherd.options).toEqual({
      baseURL: "https://gw.example/v1",
      apiKey: `{env:${OPENCODE_KEY_ENV}}`,
    });
    expect(oc?.OPENCODE_CONFIG_CONTENT).not.toContain("k1");
    expect(oc?.[OPENCODE_KEY_ENV]).toBe("k1");
    expect(agentModelEnv("claude", model, "k1")).toBeUndefined();
    expect(agentModelEnv("dsh", model, "k1")).toBeUndefined();
  });

  it("modelEnvFor needs a listed model, a key and an agent that can run it", () => {
    const store = secrets({ "model:anthropic": "sk-a" });
    expect(modelEnvFor(settings, store, "claude", "anthropic/claude-sonnet-4-5", {})).toMatchObject(
      {
        ANTHROPIC_API_KEY: "sk-a",
        ANTHROPIC_MODEL: "claude-sonnet-4-5",
      },
    );
    expect(() => modelEnvFor(settings, store, "claude", "anthropic/other", {})).toThrow(
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
