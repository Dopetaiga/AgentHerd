// Copies the model services of PI-Desktop (~/.pi-desktop) into AgentHerd's model list (ADR 0027).
// PI-Desktop keeps services in pi.sqlite (`providers`) and API keys in secrets/<sha256(ref)>.bin,
// encrypted with AES-256-GCM under secrets/.machine-key (crates/host-core/src/secrets.rs:
// base64(nonce ‖ ciphertext ‖ tag), 12-byte nonce). Keys are read here and written to
// AgentHerd's secrets.json; they are never logged or returned.

import { createDecipheriv, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CustomApi, ModelService } from "@agentherd/core";
import { SERVICE_ID_PATTERN } from "@agentherd/core";

export function piDesktopDir(home: string = homedir()): string {
  return join(home, ".pi-desktop");
}

export interface ImportedService {
  service: ModelService;
  /** The API key, if PI-Desktop has one (not read for services AgentHerd already has). */
  key?: string;
  /** True when the service was already in AgentHerd's list and only gained models. */
  merged?: boolean;
}

export interface PiDesktopServices {
  services: ImportedService[];
  /** Services that cannot be copied, with why. */
  skipped: { name: string; reason: string }[];
}

interface ProviderRow {
  id: string;
  name: string;
  vendor_key: string;
  type: string;
  api_style: string | null;
  auth_kind: string;
  base_url: string | null;
  enabled: number;
  secret_ref: string | null;
  config_json: string;
}

export interface ReadOptions {
  /** pi-ai providers that need only a key, with their base URL (to keep them "builtin"). */
  builtin: Record<string, string>;
  /** Service ids already in AgentHerd's list; new ids avoid them unless the service merges. */
  existing?: ModelService[];
}

/** Decrypts one PI-Desktop secret. */
export function readPiDesktopSecret(dir: string, ref: string): string | undefined {
  const keyFile = join(dir, "secrets", ".machine-key");
  const hash = createHash("sha256").update(ref).digest("hex");
  const file = join(dir, "secrets", `${hash}.bin`);
  if (!existsSync(keyFile) || !existsSync(file)) return undefined;
  const key = readFileSync(keyFile);
  const blob = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  if (key.length !== 32 || blob.length < 12 + 16) return undefined;
  const nonce = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const data = blob.subarray(12, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** A service id from a name, or from the URL's host when the name gives too little. */
export function serviceIdFor(
  name: string,
  baseUrl: string | undefined,
  taken: Set<string>,
): string {
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  let base = slug(name);
  if (base.length < 2 && baseUrl !== undefined) {
    try {
      base = slug(new URL(baseUrl).hostname);
    } catch {
      // keep the name's slug
    }
  }
  if (!SERVICE_ID_PATTERN.test(base)) base = "service";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base.slice(0, 36)}-${n}`;
  taken.add(id);
  return id;
}

const API_STYLES: Record<string, CustomApi> = {
  chat_completions: "openai-completions",
  anthropic_messages: "anthropic-messages",
};

/**
 * Reads PI-Desktop's enabled services with their chosen models and keys.
 * @throws When the directory or its database is missing.
 */
export function readPiDesktop(dir: string, opts: ReadOptions): PiDesktopServices {
  const dbPath = join(dir, "pi.sqlite");
  if (!existsSync(dbPath)) throw new Error(`PI-Desktop data not found at ${dir}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let rows: ProviderRow[];
  try {
    rows = db
      .prepare(
        "select id, name, vendor_key, type, api_style, auth_kind, base_url, enabled, secret_ref, config_json from providers order by created_at",
      )
      .all() as unknown as ProviderRow[];
  } finally {
    db.close();
  }
  const out: PiDesktopServices = { services: [], skipped: [] };
  const existing = opts.existing ?? [];
  const taken = new Set(existing.map((s) => s.id));
  for (const row of rows) {
    if (row.enabled !== 1) continue;
    if (row.auth_kind === "oauth") {
      out.skipped.push({ name: row.name, reason: "signs in with an account (OAuth), not a key" });
      continue;
    }
    let models: string[] = [];
    try {
      const config = JSON.parse(row.config_json) as { models?: { id?: unknown }[] };
      models = (config.models ?? [])
        .map((m) => (typeof m.id === "string" ? m.id.trim() : ""))
        .filter((m) => m !== "");
    } catch {
      models = [];
    }
    models = [...new Set(models)];
    if (models.length === 0) {
      out.skipped.push({ name: row.name, reason: "no models chosen" });
      continue;
    }
    const baseUrl = row.base_url?.trim().replace(/\/+$/, "") || undefined;
    const builtinUrl = opts.builtin[row.vendor_key];
    let service: ModelService;
    const same = existing.find(
      (s) =>
        (s.kind === "builtin" &&
          s.provider === row.vendor_key &&
          builtinUrl !== undefined &&
          (baseUrl === undefined || baseUrl === builtinUrl)) ||
        (s.kind === "openai-compatible" && s.baseUrl === baseUrl),
    );
    if (same !== undefined) {
      // Already in AgentHerd: add the models it lacks, keep its id and key.
      service = { ...same, models: [...new Set([...same.models, ...models])] };
    } else if (builtinUrl !== undefined && (baseUrl === undefined || baseUrl === builtinUrl)) {
      service = {
        id: serviceIdFor(row.vendor_key, undefined, taken),
        name: row.name,
        kind: "builtin",
        provider: row.vendor_key,
        models,
      };
    } else {
      const api = API_STYLES[row.api_style ?? "chat_completions"];
      if (api === undefined || baseUrl === undefined) {
        out.skipped.push({
          name: row.name,
          reason: `API "${row.api_style ?? "?"}" is not supported`,
        });
        continue;
      }
      service = {
        id: serviceIdFor(row.name, baseUrl, taken),
        name: row.name,
        kind: "openai-compatible",
        baseUrl,
        models,
        ...(api === "anthropic-messages" ? { api } : {}),
      };
    }
    let key: string | undefined;
    if (row.secret_ref !== null && same === undefined) {
      try {
        key = readPiDesktopSecret(dir, row.secret_ref);
      } catch {
        key = undefined;
      }
    }
    out.services.push({
      service,
      ...(key === undefined || key === "" ? {} : { key }),
      ...(same === undefined ? {} : { merged: true }),
    });
  }
  return out;
}
