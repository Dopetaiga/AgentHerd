import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SecretStore } from "@agentherd/core";
import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.ts";
import { modelCommand } from "../src/models.ts";

function setup(keys: string[] = []) {
  const home = mkdtempSync(join(tmpdir(), "agentherd-models-"));
  const saved: Record<string, string> = {};
  const secrets: SecretStore = {
    get: (a) => saved[a],
    set: (a, v) => {
      saved[a] = v;
    },
    delete: (a) => {
      delete saved[a];
    },
  };
  const lines: string[] = [];
  const run = (...args: string[]) =>
    modelCommand(home, args, (l) => lines.push(l), {
      secrets,
      readKey: async () => keys.shift() ?? "",
      env: {},
    });
  return { home, saved, lines, run };
}

describe("agentherd model", () => {
  it("adds a builtin provider, saves its key in the keychain only, and chooses the Herder", async () => {
    const t = setup(["sk-1"]);
    expect(await t.run("add", "deepseek", "--models", "deepseek-flash")).toBe(0);
    expect(t.saved).toEqual({ "model:deepseek": "sk-1" });
    expect(await t.run("use", "herder", "deepseek/deepseek-flash")).toBe(0);
    const config = readConfig(t.home);
    expect(config.models?.roles.herder).toEqual({ serviceId: "deepseek", model: "deepseek-flash" });
    expect(JSON.stringify(config)).not.toContain("sk-1");
    await t.run("list");
    expect(t.lines).toContain("herder: deepseek/deepseek-flash");
    expect(t.lines.some((l) => l.startsWith("deepseek  (deepseek, deepseek, key set)"))).toBe(true);
  });

  it("adds an OpenAI-compatible endpoint without a key and removes it", async () => {
    const t = setup();
    expect(
      await t.run(
        "add-compatible",
        "ollama",
        "--base-url",
        "http://127.0.0.1:11434/v1",
        "--models",
        "qwen3,llama3",
      ),
    ).toBe(0);
    expect(readConfig(t.home).models?.services[0]).toMatchObject({
      kind: "openai-compatible",
      models: ["qwen3", "llama3"],
    });
    expect(await t.run("use", "reviewer", "ollama/qwen3")).toBe(0);
    expect(await t.run("remove", "ollama")).toBe(0);
    expect(readConfig(t.home).models).toEqual({ services: [], roles: {} });
  });

  it("refuses unknown providers and models", async () => {
    const t = setup();
    expect(await t.run("add", "nope")).toBe(1);
    expect(t.lines.at(-1)).toMatch(/unknown provider "nope"/);
    await t.run("add", "deepseek");
    expect(await t.run("use", "herder", "deepseek/nope")).toBe(1);
    expect(await t.run("use", "boss", "deepseek/deepseek-flash")).toBe(2);
  });
});
