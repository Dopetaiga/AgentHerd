// Asks an OpenAI-compatible (or Anthropic-compatible) service which models it offers, so the
// owner can tick them instead of typing ids by hand. Both APIs answer GET <base>/models with
// `{ data: [{ id, ... }] }`; Ollama-style servers answer `{ models: [{ name }] }`.

import type { CustomApi } from "@agentherd/core";
import type { ModelProbe } from "./api.ts";

export const PROBE_TIMEOUT_MS = 15_000;

export interface ProbeOptions {
  baseUrl: string;
  api?: CustomApi;
  key?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Lists the models of a service. Never throws; a failure comes back as `{ ok: false }`. */
export async function probeModels(opts: ProbeOptions): Promise<ModelProbe> {
  let base: string;
  try {
    const url = new URL(opts.baseUrl.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, message: "the address must start with http or https" };
    }
    base = url.toString().replace(/\/+$/, "");
  } catch {
    return { ok: false, message: `not a valid address: "${opts.baseUrl}"` };
  }
  const api = opts.api ?? "openai-completions";
  const hasV1 = /\/v1$/i.test(base);
  // The OpenAI SDK calls <base>/chat/completions, so the base usually ends in /v1. The Anthropic
  // SDK adds /v1 itself, so its base usually does not.
  const bases =
    api === "anthropic-messages"
      ? hasV1
        ? [base]
        : [`${base}/v1`, base]
      : hasV1
        ? [base]
        : [base, `${base}/v1`];

  const doFetch = opts.fetch ?? fetch;
  const headers: Record<string, string> = { accept: "application/json" };
  const key = opts.key?.trim();
  if (key !== undefined && key !== "") {
    headers.authorization = `Bearer ${key}`;
    if (api === "anthropic-messages") headers["x-api-key"] = key;
  }
  if (api === "anthropic-messages") headers["anthropic-version"] = "2023-06-01";

  let firstError: string | undefined;
  for (const candidate of bases) {
    const result = await probeOnce(doFetch, candidate, headers, opts.timeoutMs ?? PROBE_TIMEOUT_MS);
    if (result.ok) {
      // Only an OpenAI-style base needs fixing: the SDK would not find /chat/completions.
      const fix = api !== "anthropic-messages" && candidate !== base;
      return { ok: true, models: result.models, ...(fix ? { baseUrl: candidate } : {}) };
    }
    firstError ??= result.message;
    // A refused key is the answer; another path will not help.
    if (result.status === 401 || result.status === 403)
      return { ok: false, message: result.message };
  }
  return { ok: false, message: firstError ?? "no answer" };
}

type Once =
  | { ok: true; models: { id: string; name: string }[] }
  | { ok: false; message: string; status?: number };

async function probeOnce(
  doFetch: typeof fetch,
  base: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Once> {
  const url = `${base}/models`;
  let res: Response;
  try {
    res = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const e = error as Error & { cause?: { message?: string } };
    const why = e.name === "TimeoutError" ? "timed out" : (e.cause?.message ?? e.message);
    return { ok: false, message: `GET ${url}: ${why}` };
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: `GET ${url}: HTTP ${res.status}${errorDetail(text)}`,
    };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, message: `GET ${url}: the answer is not JSON` };
  }
  const models = modelList(body);
  if (models === undefined)
    return { ok: false, message: `GET ${url}: no model list in the answer` };
  if (models.length === 0) return { ok: false, message: `GET ${url}: the service lists no models` };
  return { ok: true, models };
}

/** The models of a `/models` answer, sorted by id; undefined when it is not a model list. */
export function modelList(body: unknown): { id: string; name: string }[] | undefined {
  const list = Array.isArray(body)
    ? body
    : isObject(body) && Array.isArray(body.data)
      ? body.data
      : isObject(body) && Array.isArray(body.models)
        ? body.models
        : undefined;
  if (list === undefined) return undefined;
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const item of list) {
    const id =
      typeof item === "string"
        ? item
        : isObject(item)
          ? (str(item.id) ?? str(item.name))
          : undefined;
    if (id === undefined || id === "" || seen.has(id)) continue;
    seen.add(id);
    const name = isObject(item) ? (str(item.display_name) ?? str(item.name) ?? id) : id;
    out.push({ id, name });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function errorDetail(text: string): string {
  let detail = text.trim();
  try {
    const body: unknown = JSON.parse(text);
    if (isObject(body)) {
      const err = body.error;
      detail =
        (isObject(err) ? str(err.message) : str(err)) ??
        str(body.message) ??
        str(body.detail) ??
        detail;
    }
  } catch {
    // Not JSON: keep the text.
  }
  detail = detail.replace(/\s+/g, " ").slice(0, 200);
  return detail === "" ? "" : ` ${detail}`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
