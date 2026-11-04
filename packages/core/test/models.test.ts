import { describe, expect, it } from "vitest";
import {
  chooseModel,
  emptyModelSettings,
  type ModelService,
  modelFor,
  parseModelRef,
  putService,
  removeService,
} from "../src/models.ts";

const deepseek: ModelService = {
  id: "deepseek",
  name: "DeepSeek",
  kind: "builtin",
  provider: "deepseek",
  models: ["deepseek-flash", "deepseek-v4-pro"],
};
const relay: ModelService = {
  id: "my-relay",
  name: "My relay",
  kind: "openai-compatible",
  baseUrl: "https://relay.example.com/v1",
  models: ["anthropic/claude-x"],
};

describe("model settings", () => {
  it("adds services and chooses a model per role", () => {
    let s = putService(emptyModelSettings(), deepseek);
    s = putService(s, relay);
    s = chooseModel(s, "herder", parseModelRef("deepseek/deepseek-flash"));
    s = chooseModel(s, "reviewer", parseModelRef("my-relay/anthropic/claude-x"));
    expect(modelFor(s, "herder")?.model).toBe("deepseek-flash");
    expect(modelFor(s, "reviewer")).toEqual({ service: relay, model: "anthropic/claude-x" });
  });

  it("refuses a model the service does not have and a bad service", () => {
    const s = putService(emptyModelSettings(), deepseek);
    expect(() => chooseModel(s, "herder", { serviceId: "deepseek", model: "x" })).toThrow(
      /no model "x"/,
    );
    expect(() => chooseModel(s, "herder", { serviceId: "nope", model: "x" })).toThrow(/no service/);
    expect(() => putService(s, { ...relay, baseUrl: "ftp://x" })).toThrow(/http or https/);
    expect(() => putService(s, { ...relay, id: "Bad Id" })).toThrow(/lowercase/);
    expect(() => putService(s, { ...relay, models: [] })).toThrow(/no models/);
    expect(() => putService(s, { ...deepseek, provider: "" })).toThrow(/needs a provider/);
  });

  it("clears roles whose model is gone", () => {
    let s = putService(emptyModelSettings(), deepseek);
    s = chooseModel(s, "herder", { serviceId: "deepseek", model: "deepseek-v4-pro" });
    s = putService(s, { ...deepseek, models: ["deepseek-flash"] });
    expect(s.roles.herder).toBeUndefined();
    s = chooseModel(s, "herder", { serviceId: "deepseek", model: "deepseek-flash" });
    s = removeService(s, "deepseek");
    expect(s).toEqual({ services: [], roles: {} });
    expect(() => removeService(s, "deepseek")).toThrow(/no service/);
  });

  it("parses refs", () => {
    expect(() => parseModelRef("deepseek")).toThrow(/expected/);
    expect(() => parseModelRef("deepseek/")).toThrow(/expected/);
  });
});
