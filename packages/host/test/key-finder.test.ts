import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ModelService, SecretStore } from "@agentherd/core";
import { describe, expect, it } from "vitest";
import {
  alreadyAdded,
  findServices,
  keyHint,
  mergeFound,
  sameUrl,
  serviceIdFor,
  tomlStrings,
} from "../src/key-finder.ts";

function home(): string {
  return mkdtempSync(join(tmpdir(), "ah-keys-"));
}

function put(dir: string, rel: string, text: string): void {
  const file = join(dir, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
}

const noSecrets: SecretStore = {
  get: () => undefined,
  set: () => undefined,
  delete: () => undefined,
};

describe("finding the model services other apps hold (ADR 0107)", () => {
  it("reads Claude Code, Codex, DeepSeek Harness, Pi and OpenCode without writing anything", () => {
    const h = home();
    put(
      h,
      ".claude/settings.json",
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: "cr_claude_key_1234",
          ANTHROPIC_BASE_URL: "https://relay.example/api",
          ANTHROPIC_MODEL: "claude-opus-5-5",
        },
      }),
    );
    put(h, ".codex/config.toml", 'model = "gpt-5.5"\n\n[features]\nx = true\n');
    put(h, ".codex/auth.json", JSON.stringify({ OPENAI_API_KEY: "sk-openai-key-5678" }));
    put(
      h,
      ".dsh/profiles/desktop/cordis.patch.yml",
      [
        "- id: llm-deepseek",
        "  config:",
        "    apiKeyEnv: DEEPSEEK_API_KEY",
        "    models:",
        "      - id: deepseek-flash",
        "- id: llm-pi-ai",
        "  config:",
        "    providers:",
        "      step:",
        "        displayName: StepPlan",
        "        api: openai-completions",
        "        baseURL: https://api.stepfun.com/step_plan/v1",
        "        apiKeyEnv: STEP_KEY",
        "        models:",
        "          - id: step-5",
        "      resp:",
        "        displayName: 只认 Responses",
        "        api: openai-responses",
        "        baseURL: https://resp.example",
        "        apiKeyEnv: RESP_KEY",
      ].join("\n"),
    );
    put(
      h,
      ".dsh/.credentials.yaml",
      "refs:\n  DEEPSEEK_API_KEY: sk-deepseek-abcdef\n  STEP_KEY: step-key-123456\n  RESP_KEY: resp-key-123456\n",
    );
    put(
      h,
      ".pi/agent/auth.json",
      JSON.stringify({ deepseek: { type: "api_key", key: "sk-deepseek-abcdef" } }),
    );
    put(
      h,
      ".local/share/opencode/auth.json",
      JSON.stringify({ openrouter: { type: "api", key: "sk-or-key-000000" } }),
    );

    const scan = findServices(h, {});
    const rows = scan.services.map((s) => [
      s.name,
      s.sources,
      s.kind,
      s.provider ?? s.baseUrl,
      s.api,
      s.models,
    ]);
    expect(rows).toEqual([
      ["DeepSeek", ["dsh", "pi"], "builtin", "deepseek", undefined, ["deepseek-flash"]],
      ["OpenAI", ["codex"], "builtin", "openai", undefined, ["gpt-5.5"]],
      ["openrouter", ["opencode"], "builtin", "openrouter", undefined, []],
      [
        "relay.example",
        ["claude-code"],
        "openai-compatible",
        "https://relay.example/api",
        "anthropic-messages",
        ["claude-opus-5-5"],
      ],
      [
        "StepPlan",
        ["dsh"],
        "openai-compatible",
        "https://api.stepfun.com/step_plan/v1",
        "openai-completions",
        ["step-5"],
      ],
    ]);
    expect(scan.problems).toEqual([
      {
        source: "dsh",
        message: "「只认 Responses」只能用 OpenAI Responses 格式，AgentHerd 用不了",
      },
    ]);
  });

  it("reads CC Switch's database: Claude rows, Codex rows and app rows", () => {
    const h = home();
    mkdirSync(join(h, ".cc-switch"));
    const db = new DatabaseSync(join(h, ".cc-switch", "cc-switch.db"));
    db.exec("CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT)");
    const add = db.prepare("INSERT INTO providers VALUES (?, ?, ?, ?)");
    add.run(
      "1",
      "claude",
      "default",
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: "sk-relay-key-999",
          ANTHROPIC_BASE_URL: "https://znb.example",
        },
      }),
    );
    add.run("2", "claude", "Claude Official", JSON.stringify({ env: {} }));
    add.run(
      "3",
      "codex",
      "Kimi",
      JSON.stringify({
        auth: { OPENAI_API_KEY: "sk-kimi-key-1234" },
        config:
          'model_provider = "kimi"\nmodel = "kimi-k3"\n[model_providers.kimi]\nname = "Kimi"\nbase_url = "https://api.kimi.example/v1"\nwire_api = "chat"\n',
      }),
    );
    add.run(
      "4",
      "codex",
      "Relay",
      JSON.stringify({
        auth: { OPENAI_API_KEY: "sk-relay-key-555" },
        config:
          'model_provider = "r"\n[model_providers.r]\nbase_url = "https://r.example/v1"\nwire_api = "responses"\n',
      }),
    );
    add.run(
      "5",
      "opencode",
      "Gate",
      JSON.stringify({
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "https://gate.example/v1", apiKey: "{env:GATE}" },
      }),
    );
    add.run("6", "opencode", "Gate2", "not json");
    db.close();

    const scan = findServices(h, {});
    expect(scan.services.map((s) => [s.name, s.baseUrl, s.api, s.models])).toEqual([
      ["Kimi", "https://api.kimi.example/v1", "openai-completions", ["kimi-k3"]],
      ["znb.example", "https://znb.example", "anthropic-messages", []],
    ]);
    expect(scan.problems.map((p) => p.message)).toEqual([
      "「Relay」只能用 OpenAI Responses 格式，AgentHerd 用不了",
      "「Gate2」的设置不是有效的 JSON",
    ]);
  });

  it("finds keys in environment variables pi-ai knows, and keeps one broken app from hiding the rest", () => {
    const h = home();
    put(h, ".claude/settings.json", "{ broken");
    const scan = findServices(h, { DEEPSEEK_API_KEY: "sk-env-deepseek-1" });
    expect(scan.services.map((s) => [s.name, s.sources, s.provider])).toEqual([
      ["deepseek", ["env"], "deepseek"],
    ]);
    expect(scan.problems).toEqual([
      { source: "claude-code", message: "Claude Code settings.json 不是有效的 JSON" },
    ]);
  });

  it("one service per address and key; tells which ones are already in AgentHerd", () => {
    const merged = mergeFound([
      {
        source: "dsh",
        name: "",
        key: "k-111111111111",
        baseUrl: "https://A.example/v1/",
        api: "anthropic-messages",
        models: ["m1"],
      },
      {
        source: "cc-switch",
        name: "Gate",
        key: "k-111111111111",
        baseUrl: "https://a.example/v1",
        api: "anthropic-messages",
        models: ["m1", "m2"],
      },
      {
        source: "pi",
        name: "Gate",
        key: "k-222222222222",
        baseUrl: "https://a.example/v1",
        api: "anthropic-messages",
        models: [],
      },
    ]);
    expect(merged.map((s) => [s.name, s.sources, s.models])).toEqual([
      ["Gate", ["dsh", "cc-switch"], ["m1", "m2"]],
      ["Gate", ["pi"], []],
    ]);
    const first = merged[0];
    if (first === undefined) throw new Error("none");
    const saved: ModelService = {
      id: "gate",
      name: "我的网关",
      kind: "openai-compatible",
      baseUrl: "https://a.example/v1",
      api: "anthropic-messages",
      models: ["m1"],
    };
    const secrets: SecretStore = {
      ...noSecrets,
      get: (a) => (a === "model:gate" ? "k-111111111111" : undefined),
    };
    expect(alreadyAdded(first, [saved], secrets, {})?.id).toBe("gate");
    expect(alreadyAdded(merged[1] ?? first, [saved], secrets, {})).toBeUndefined();
    expect(sameUrl("https://A.example/v1/")).toBe("https://a.example/v1");
  });

  it("never shows a key, and names the new service with an id not in use", () => {
    expect(keyHint("sk-abcdefghijklmn9f2c")).toBe("sk-a…9f2c");
    expect(keyHint("short")).toBe("…");
    const found = mergeFound([
      {
        source: "dsh",
        name: "小豆泥",
        key: "k-1",
        baseUrl: "http://127.0.0.1:13000",
        api: "anthropic-messages",
        models: [],
      },
    ])[0];
    if (found === undefined) throw new Error("none");
    expect(serviceIdFor(found, new Set())).toBe("127-0-0-1-13000");
    const deepseek = mergeFound([
      { source: "env", name: "DeepSeek", key: "k-2", provider: "deepseek", models: [] },
    ])[0];
    if (deepseek === undefined) throw new Error("none");
    expect(serviceIdFor(deepseek, new Set(["deepseek"]))).toBe("deepseek-2");
  });

  it("reads the string settings of a TOML file by table", () => {
    const t = tomlStrings(
      'model = "gpt-5.5" # note\n[model_providers."my-gw"]\nbase_url = \'https://gw\'\nn = 3\n',
    );
    expect(t.get("")).toEqual({ model: "gpt-5.5" });
    expect(t.get("model_providers.my-gw")).toEqual({ base_url: "https://gw" });
  });
});
