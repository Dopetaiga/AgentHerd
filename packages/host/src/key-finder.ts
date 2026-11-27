// Finds the model services other apps on this computer are already set up with (ADR 0107), so the
// owner can add one without typing its key again. Only reads: never writes those files, never runs
// a command to get a key, never opens the Keychain, and leaves out account sign-ins (those have
// 用订阅登录). A service the app keeps in a form AgentHerd cannot call (OpenAI Responses only,
// extra request headers) is left out with a note saying why.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CustomApi, ModelService, SecretStore } from "@agentherd/core";
import { builtinProviders, serviceKey } from "@agentherd/herder";
import { parse as parseYaml } from "yaml";

export const FOUND_SOURCES = [
  "claude-code",
  "cc-switch",
  "codex",
  "dsh",
  "pi",
  "opencode",
  "env",
] as const;
export type FoundSource = (typeof FOUND_SOURCES)[number];

/** One service as one app declares it, key included. */
export interface FoundDeclared {
  source: FoundSource;
  name: string;
  key: string;
  /** A provider pi-ai knows; `baseUrl` is then unset. */
  provider?: string;
  baseUrl?: string;
  api?: CustomApi;
  models: string[];
}

/** One service found, merged across apps by address and key. The key stays in the host. */
export interface FoundService {
  id: string;
  name: string;
  sources: FoundSource[];
  kind: "builtin" | "openai-compatible";
  provider?: string;
  baseUrl?: string;
  api?: CustomApi;
  models: string[];
  key: string;
}

export interface FoundProblem {
  source: FoundSource;
  message: string;
}

export interface FoundScan {
  services: FoundService[];
  problems: FoundProblem[];
}

interface ScanContext {
  home: string;
  env: Record<string, string | undefined>;
  known: Set<string>;
  problem(message: string): void;
}

/** Changes every start, so a found id is never a lasting fingerprint of its key. */
const ID_SALT = randomBytes(16);

const READERS: Record<FoundSource, (c: ScanContext) => FoundDeclared[]> = {
  "claude-code": readClaudeCode,
  "cc-switch": readCcSwitch,
  codex: readCodex,
  dsh: readDsh,
  pi: readPi,
  opencode: readOpenCode,
  env: readEnv,
};

/** Reads every app; one app's broken file never hides what the others hold. */
export function findServices(home: string, env: Record<string, string | undefined>): FoundScan {
  const known = new Set(builtinProviders().map((p) => p.provider));
  const problems: FoundProblem[] = [];
  const declared: FoundDeclared[] = [];
  for (const source of FOUND_SOURCES) {
    const problem = (message: string): void => {
      problems.push({ source, message });
    };
    try {
      declared.push(...READERS[source]({ home, env, known, problem }));
    } catch (err) {
      problem((err as Error).message);
    }
  }
  return { services: mergeFound(declared), problems };
}

/** The same key at the same address is one service, however many apps use it. */
export function mergeFound(declared: FoundDeclared[]): FoundService[] {
  const byKey = new Map<string, FoundService>();
  for (const d of declared) {
    const where =
      d.provider !== undefined
        ? `builtin:${d.provider}`
        : `${sameUrl(d.baseUrl ?? "")}|${d.api ?? ""}`;
    const mergeKey = `${where}\n${d.key}`;
    let s = byKey.get(mergeKey);
    if (s === undefined) {
      s = {
        id: createHash("sha256").update(ID_SALT).update(mergeKey).digest("hex").slice(0, 12),
        name: d.name,
        sources: [],
        kind: d.provider !== undefined ? "builtin" : "openai-compatible",
        models: [],
        key: d.key,
      };
      if (d.provider !== undefined) s.provider = d.provider;
      if (d.baseUrl !== undefined) s.baseUrl = d.baseUrl;
      if (d.api !== undefined && d.provider === undefined) s.api = d.api;
      byKey.set(mergeKey, s);
    }
    if (s.name === "" && d.name !== "") s.name = d.name;
    if (!s.sources.includes(d.source)) s.sources.push(d.source);
    for (const m of d.models) if (m !== "" && !s.models.includes(m)) s.models.push(m);
  }
  return [...byKey.values()]
    .map((s) => (s.name === "" ? { ...s, name: s.provider ?? hostOf(s.baseUrl ?? "") } : s))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The service already set up in AgentHerd that a found one is, if any. */
export function alreadyAdded(
  found: FoundService,
  services: readonly ModelService[],
  secrets: SecretStore,
  env?: Record<string, string>,
): ModelService | undefined {
  return services.find((s) => {
    if (s.auth === "subscription") return false;
    if (found.kind === "builtin") {
      if (s.kind !== "builtin" || s.provider !== found.provider) return false;
    } else {
      if (s.kind !== "openai-compatible") return false;
      if (sameUrl(s.baseUrl ?? "") !== sameUrl(found.baseUrl ?? "")) return false;
      if ((s.api ?? "openai-completions") !== (found.api ?? "openai-completions")) return false;
    }
    const key = serviceKey(s, secrets, env);
    return key === undefined || key === found.key;
  });
}

/** `sk-a…9f2c`: enough to tell keys apart, never the key. */
export function keyHint(key: string): string {
  return key.length <= 12 ? "…" : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** An id for the service in AgentHerd: from its name, else its provider or host; never one in use. */
export function serviceIdFor(found: FoundService, used: ReadonlySet<string>): string {
  const from = [found.name, found.provider ?? "", hostOf(found.baseUrl ?? "")];
  let base = "";
  for (const text of from) {
    base = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 34);
    if (base !== "") break;
  }
  if (base === "") base = "service";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

function readClaudeCode({ home, env }: ScanContext): FoundDeclared[] {
  const dir = env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
  const settings = readJson(join(dir, "settings.json"), "Claude Code settings.json");
  if (settings === undefined) return [];
  const one = anthropicFrom(record(settings.env), "claude-code", "");
  return one === undefined ? [] : [one];
}

/** Claude Code's and CC Switch's Claude rows: the key, address and models in `env`. */
function anthropicFrom(
  vars: Record<string, unknown>,
  source: FoundSource,
  name: string,
): FoundDeclared | undefined {
  const key = str(vars.ANTHROPIC_AUTH_TOKEN) || str(vars.ANTHROPIC_API_KEY);
  if (key === "") return undefined;
  const models = [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
  ].map((v) => str(vars[v]));
  const baseUrl = str(vars.ANTHROPIC_BASE_URL);
  return baseUrl === ""
    ? { source, name, key, provider: "anthropic", models: unique(models) }
    : { source, name, key, baseUrl, api: "anthropic-messages", models: unique(models) };
}

function readCcSwitch({ home, known, problem }: ScanContext): FoundDeclared[] {
  const file = join(home, ".cc-switch", "cc-switch.db");
  if (!existsSync(file)) return [];
  let rows: Record<string, unknown>[];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    rows = db.prepare("SELECT app_type, name, settings_config FROM providers").all() as Record<
      string,
      unknown
    >[];
  } finally {
    db.close();
  }
  const out: FoundDeclared[] = [];
  for (const row of rows) {
    const rowName = str(row.name);
    // CC Switch calls the setup it took over "default", which says nothing about the service.
    const name = rowName === "default" ? "" : rowName;
    let settings: Record<string, unknown>;
    try {
      settings = record(JSON.parse(str(row.settings_config)));
    } catch {
      problem(`「${rowName}」的设置不是有效的 JSON`);
      continue;
    }
    const vars = record(settings.env);
    const app = str(row.app_type);
    if (app === "claude" || app === "claude-desktop") {
      const one = anthropicFrom(vars, "cc-switch", name);
      if (one !== undefined) out.push(one);
    } else if (app === "codex") {
      const toml = tomlStrings(str(settings.config));
      const key = str(record(settings.auth).OPENAI_API_KEY);
      const one = codexService(toml, key, "cc-switch", name, problem);
      if (one !== undefined) out.push(one);
    } else if (app === "gemini") {
      const key = str(vars.GEMINI_API_KEY) || str(vars.GOOGLE_API_KEY);
      if (key !== "" && str(vars.GOOGLE_GEMINI_BASE_URL) === "" && known.has("google")) {
        out.push({
          source: "cc-switch",
          name,
          key,
          provider: "google",
          models: unique([str(vars.GEMINI_MODEL)]),
        });
      }
    } else {
      const options = record(settings.options);
      const baseUrl = first(
        settings.baseUrl,
        settings.baseURL,
        settings.base_url,
        options.baseURL,
        options.baseUrl,
      );
      const key = literal(
        first(settings.apiKey, settings.api_key, options.apiKey, options.api_key),
      );
      if (baseUrl === "" || key === "") continue;
      const kind = first(settings.api, settings.npm, settings.type).toLowerCase();
      if (kind.includes("responses")) {
        problem(`「${rowName}」只能用 OpenAI Responses 格式，AgentHerd 用不了`);
        continue;
      }
      const models = Array.isArray(settings.models)
        ? settings.models.map((m) => (typeof m === "string" ? m : str(record(m).id)))
        : Object.keys(record(settings.models));
      out.push({
        source: "cc-switch",
        name,
        key,
        baseUrl,
        api: kind.includes("anthropic") ? "anthropic-messages" : "openai-completions",
        models: unique(models),
      });
    }
  }
  return out;
}

function readCodex({ home, env, problem }: ScanContext): FoundDeclared[] {
  const dir = env.CODEX_HOME?.trim() || join(home, ".codex");
  const configFile = join(dir, "config.toml");
  const toml = tomlStrings(existsSync(configFile) ? readFileSync(configFile, "utf8") : "");
  const auth = readJson(join(dir, "auth.json"), "Codex auth.json") ?? {};
  const providerId = toml.get("")?.model_provider ?? "";
  const providerKey =
    providerId === "" || providerId === "openai"
      ? str(env.OPENAI_API_KEY) || str(auth.OPENAI_API_KEY)
      : str(env[toml.get(`model_providers.${providerId}`)?.env_key ?? ""]) ||
        (toml.get(`model_providers.${providerId}`)?.experimental_bearer_token ?? "");
  const one = codexService(toml, providerKey, "codex", "", problem);
  return one === undefined ? [] : [one];
}

/** Codex's current provider: OpenAI itself, or a provider section speaking chat completions. */
function codexService(
  toml: Map<string, Record<string, string>>,
  key: string,
  source: FoundSource,
  name: string,
  problem: (message: string) => void,
): FoundDeclared | undefined {
  if (key === "") return undefined;
  const top = toml.get("") ?? {};
  const providerId = top.model_provider ?? "";
  const models = unique([top.model ?? ""]);
  if (providerId === "" || providerId === "openai") {
    return { source, name: name || "OpenAI", key, provider: "openai", models };
  }
  const p = toml.get(`model_providers.${providerId}`) ?? {};
  const baseUrl = p.base_url ?? "";
  if (baseUrl === "") return undefined;
  const label = name || p.name || providerId;
  if (p.wire_api !== "chat") {
    problem(`「${label}」只能用 OpenAI Responses 格式，AgentHerd 用不了`);
    return undefined;
  }
  return { source, name: label, key, baseUrl, api: "openai-completions", models };
}

function readDsh({ home, env, known, problem }: ScanContext): FoundDeclared[] {
  const root = env.DSH_HOME?.trim() || join(home, ".dsh");
  const profilesDir = join(root, "profiles");
  if (!existsSync(profilesDir)) return [];
  const credFile = join(root, ".credentials.yaml");
  const refs = record(
    record(existsSync(credFile) ? parseYaml(readFileSync(credFile, "utf8")) : {}).refs,
  );
  // DeepSeek Harness reads its own credential file first, then the environment.
  const keyOf = (name: string): string => str(refs[name]) || str(env[name]);
  const out: FoundDeclared[] = [];
  for (const profile of readdirSync(profilesDir)) {
    const file = join(profilesDir, profile, "cordis.patch.yml");
    if (!existsSync(file)) continue;
    const entries = list(parseYaml(readFileSync(file, "utf8"))).map(record);
    const deepseek = entries.filter((e) => e.id === "llm-deepseek" && e.disabled !== true);
    for (const config of deepseek.length > 0 ? deepseek.map((e) => record(e.config)) : [{}]) {
      const key = keyOf(str(config.apiKeyEnv) || "DEEPSEEK_API_KEY");
      if (key === "") continue;
      const baseUrl = str(config.baseURL);
      const models = modelIds(config.models);
      out.push(
        baseUrl === ""
          ? { source: "dsh", name: "DeepSeek", key, provider: "deepseek", models }
          : { source: "dsh", name: "DeepSeek", key, baseUrl, api: "openai-completions", models },
      );
    }
    for (const entry of entries.filter((e) => e.id === "llm-pi-ai" && e.disabled !== true)) {
      for (const [id, value] of Object.entries(record(record(entry.config).providers))) {
        const p = record(value);
        const key = keyOf(
          str(p.apiKeyEnv) || `${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`,
        );
        if (key === "") continue;
        const one = piStyle(
          "dsh",
          str(p.displayName) || id,
          id,
          key,
          str(p.baseURL),
          str(p.api),
          modelIds(p.models),
          known,
          problem,
        );
        if (one !== undefined) out.push(one);
      }
    }
  }
  return out;
}

/** A provider written the pi-ai way: a known provider id without an address, or an address and an API. */
function piStyle(
  source: FoundSource,
  name: string,
  id: string,
  key: string,
  baseUrl: string,
  api: string,
  models: string[],
  known: Set<string>,
  problem: (message: string) => void,
): FoundDeclared | undefined {
  if (baseUrl === "") {
    return known.has(id) ? { source, name, key, provider: id, models } : undefined;
  }
  if (api === "openai-responses") {
    problem(`「${name}」只能用 OpenAI Responses 格式，AgentHerd 用不了`);
    return undefined;
  }
  if (api !== "openai-completions" && api !== "anthropic-messages") return undefined;
  return { source, name, key, baseUrl, api, models };
}

function readPi({ home, env, known, problem }: ScanContext): FoundDeclared[] {
  const dir = env.PI_CODING_AGENT_DIR?.trim() || join(home, ".pi", "agent");
  const providers = record(readJson(join(dir, "models.json"), "Pi models.json")?.providers);
  const auth = readJson(join(dir, "auth.json"), "Pi auth.json") ?? {};
  // A key is written as is, as the name of an environment variable, or as a `!command` (never run).
  const keyOf = (value: string): string => {
    if (value === "" || value.startsWith("!")) return "";
    if (env[value]?.trim()) return env[value]?.trim() ?? "";
    return /^[A-Z][A-Z0-9_]*$/.test(value) ? "" : value;
  };
  const saved = (id: string): string => {
    const entry = record(auth[id]);
    return entry.type === "api_key" ? keyOf(str(entry.key)) : "";
  };
  const out: FoundDeclared[] = [];
  for (const [id, value] of Object.entries(providers)) {
    const p = record(value);
    const key = saved(id) || keyOf(str(p.apiKey));
    if (key === "") continue;
    const one = piStyle(
      "pi",
      str(p.name) || id,
      id,
      key,
      str(p.baseUrl),
      str(p.api),
      modelIds(p.models),
      known,
      problem,
    );
    if (one !== undefined) out.push(one);
  }
  for (const id of Object.keys(auth)) {
    const key = saved(id);
    if (!(id in providers) && key !== "" && known.has(id))
      out.push({ source: "pi", name: id, key, provider: id, models: [] });
  }
  return out;
}

function readOpenCode({ home, env, known }: ScanContext): FoundDeclared[] {
  const dir = env.XDG_DATA_HOME?.trim() || join(home, ".local", "share");
  const auth = readJson(join(dir, "opencode", "auth.json"), "OpenCode auth.json") ?? {};
  const out: FoundDeclared[] = [];
  for (const [id, value] of Object.entries(auth)) {
    const entry = record(value);
    // OpenCode keeps only a key per provider id; it is used only where the id is a provider pi-ai knows.
    if (entry.type === "api" && str(entry.key) !== "" && known.has(id)) {
      out.push({ source: "opencode", name: id, key: str(entry.key), provider: id, models: [] });
    }
  }
  return out;
}

/** Keys in environment variables pi-ai knows (DEEPSEEK_API_KEY, OPENAI_API_KEY…). */
function readEnv({ env, known }: ScanContext): FoundDeclared[] {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== "") vars[k] = v;
  const none: SecretStore = { get: () => undefined, set: () => undefined, delete: () => undefined };
  const out: FoundDeclared[] = [];
  for (const provider of known) {
    const key = serviceKey(
      { id: "env", name: provider, kind: "builtin", provider, models: [] },
      none,
      vars,
    );
    if (key !== undefined && key !== "")
      out.push({ source: "env", name: provider, key, provider, models: [] });
  }
  return out;
}

/**
 * The string values of a TOML file by table (`""` for the top), which is all Codex's provider
 * settings need. Arrays, inline tables and numbers are skipped.
 */
export function tomlStrings(text: string): Map<string, Record<string, string>> {
  const tables = new Map<string, Record<string, string>>([["", {}]]);
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const table = /^\[([^\]]+)\]$/.exec(line);
    if (table !== null) {
      current = (table[1] ?? "")
        .split(".")
        .map((p) => p.trim().replace(/^"|"$/g, ""))
        .join(".");
      if (!tables.has(current)) tables.set(current, {});
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
    if (pair === null) continue;
    const value = pair[2] !== undefined ? pair[2].replace(/\\(.)/g, "$1") : (pair[3] ?? "");
    const into = tables.get(current);
    if (into !== undefined) into[pair[1] ?? ""] = value;
  }
  return tables;
}

function readJson(file: string, label: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return record(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    throw new Error(`${label} 不是有效的 JSON`);
  }
}

/** A key written as a reference (`{env:NAME}`, `${NAME}`, `!command`) is its app's to resolve. */
function literal(value: string): string {
  return /^(?:\{env:|\$\{|!)/.test(value) ? "" : value;
}

/** Same address: no trailing slash, case-insensitive host. */
export function sameUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return trimmed;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function modelIds(value: unknown): string[] {
  return unique(list(value).map((m) => (typeof m === "string" ? m : str(record(m).id))));
}

function first(...values: unknown[]): string {
  return values.map(str).find((v) => v !== "") ?? "";
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v !== ""))];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A mark that stays the same across looks and restarts for one place and key, so a service the
 * owner put away stays away. Only a short hash goes into the config, never the key.
 */
export function foundMark(
  s: Pick<FoundService, "kind" | "provider" | "baseUrl" | "api" | "key">,
): string {
  const where =
    s.kind === "builtin"
      ? `p:${s.provider ?? ""}`
      : `u:${(s.baseUrl ?? "").replace(/\/+$/, "")}|${s.api ?? ""}`;
  return createHash("sha256")
    .update(`agentherd-found|${where}|${s.key}`)
    .digest("hex")
    .slice(0, 16);
}
