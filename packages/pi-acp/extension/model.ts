// A Pi extension that registers the model the owner chose for Pi in AgentHerd (docs/adr/0022).
// The host passes the model in AGENTHERD_PI_MODEL (JSON, a pi-ai model without secrets) and the
// key in AGENTHERD_PI_KEY, so the key is never on Pi's command line. Self-contained like gate.ts.

export const PI_PROVIDER = "agentherd";
export const MODEL_ENV = "AGENTHERD_PI_MODEL";
export const KEY_ENV = "AGENTHERD_PI_KEY";

export interface PiModel {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  [field: string]: unknown;
}

export interface ModelApi {
  registerProvider(name: string, config: Record<string, unknown>): void;
}

/** @returns The model from the environment, or `undefined` when none is set or it is invalid. */
export function modelFromEnv(env: NodeJS.ProcessEnv): PiModel | undefined {
  const raw = env[MODEL_ENV];
  if (raw === undefined || raw === "") return undefined;
  try {
    const m = JSON.parse(raw) as Partial<PiModel>;
    if (typeof m.id !== "string" || typeof m.api !== "string" || typeof m.baseUrl !== "string") {
      return undefined;
    }
    return { ...m, name: typeof m.name === "string" ? m.name : m.id } as PiModel;
  } catch {
    return undefined;
  }
}

export default function model(pi: ModelApi): void {
  const m = modelFromEnv(process.env);
  if (m === undefined) return;
  const { provider: _provider, ...config } = m;
  pi.registerProvider(PI_PROVIDER, {
    name: "AgentHerd",
    baseUrl: m.baseUrl,
    api: m.api,
    apiKey: `$${KEY_ENV}`,
    models: [config],
  });
}
