import { describe, expect, it } from "vitest";
import { herderSetup } from "../src/herder.ts";

describe("herderSetup", () => {
  it("defaults to deepseek-flash with the key from the environment", () => {
    const s = herderSetup(undefined, () => "from-keychain", { DEEPSEEK_API_KEY: "from-env" });
    expect(s).toMatchObject({ provider: "deepseek", model: "deepseek-flash", keySource: "env" });
  });

  it("falls back to the keychain", () => {
    const s = herderSetup({ model: "deepseek-v4-pro" }, () => "k", {});
    expect(s).toMatchObject({ model: "deepseek-v4-pro", keySource: "keychain" });
  });

  it("has no Herder without a key", () => {
    const s = herderSetup(undefined, () => undefined, {});
    expect(s).toEqual({ reason: expect.stringContaining("agentherd setup herder") });
  });

  it("rejects an unknown model", () => {
    const s = herderSetup({ model: "nope" }, () => "k", {});
    expect(s).toEqual({ reason: "unknown Herder model deepseek/nope" });
  });
});
