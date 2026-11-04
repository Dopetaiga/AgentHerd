// The owner's model list (ADR 0021): services, each with the models the owner turned on, and the
// model chosen for each role. No secrets here; keys are in a SecretStore under modelKeyAccount().
// The core does not import pi-ai; packages/herder turns a choice into a pi-ai model.

export type ModelRole = "herder" | "reviewer";

export const MODEL_ROLES: readonly ModelRole[] = ["herder", "reviewer"];

export interface ModelService {
  /** Stable id, also the keychain account suffix. Lowercase letters, digits and "-". */
  id: string;
  name: string;
  /** "builtin": a provider pi-ai knows (needs only a key). "openai-compatible": any endpoint. */
  kind: "builtin" | "openai-compatible";
  /** pi-ai provider id, for "builtin". */
  provider?: string;
  /** Base URL, for "openai-compatible". */
  baseUrl?: string;
  /** Model ids turned on for this service. */
  models: string[];
}

export interface ModelRef {
  serviceId: string;
  model: string;
}

export interface ModelSettings {
  services: ModelService[];
  roles: Partial<Record<ModelRole, ModelRef>>;
}

/** Reads and writes secrets, e.g. the OS keychain. */
export interface SecretStore {
  get(account: string): string | undefined;
  set(account: string, value: string): void;
  delete(account: string): void;
}

export const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function emptyModelSettings(): ModelSettings {
  return { services: [], roles: {} };
}

export function modelKeyAccount(serviceId: string): string {
  return `model:${serviceId}`;
}

/** "service/model"; the model id may itself contain "/" (e.g. "anthropic/claude-x" on OpenRouter). */
export function parseModelRef(text: string): ModelRef {
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) {
    throw new Error(`expected <service>/<model>, got "${text}"`);
  }
  return { serviceId: text.slice(0, slash), model: text.slice(slash + 1) };
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.serviceId}/${ref.model}`;
}

function checkService(service: ModelService): void {
  if (!SERVICE_ID_PATTERN.test(service.id)) {
    throw new Error(`service id "${service.id}" must be lowercase letters, digits and "-"`);
  }
  if (service.name.trim() === "") throw new Error("service name is empty");
  if (service.models.length === 0) throw new Error(`service "${service.id}" has no models`);
  if (new Set(service.models).size !== service.models.length) {
    throw new Error(`service "${service.id}" lists a model twice`);
  }
  if (service.models.some((m) => m.trim() === "")) throw new Error("empty model id");
  if (service.kind === "builtin") {
    if (service.provider === undefined || service.provider === "") {
      throw new Error(`builtin service "${service.id}" needs a provider`);
    }
  } else {
    let url: URL;
    try {
      url = new URL(service.baseUrl ?? "");
    } catch {
      throw new Error(`service "${service.id}" needs a base URL like https://host/v1`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error(`base URL of "${service.id}" must be http or https`);
    }
  }
}

/** Adds a service, or replaces the one with the same id. Roles that point at models it no longer has are cleared. */
export function putService(settings: ModelSettings, service: ModelService): ModelSettings {
  checkService(service);
  const services = settings.services.filter((s) => s.id !== service.id);
  services.push(service);
  return pruneRoles({ services, roles: settings.roles });
}

export function removeService(settings: ModelSettings, serviceId: string): ModelSettings {
  if (!settings.services.some((s) => s.id === serviceId)) {
    throw new Error(`no service "${serviceId}"`);
  }
  return pruneRoles({
    services: settings.services.filter((s) => s.id !== serviceId),
    roles: settings.roles,
  });
}

export function chooseModel(
  settings: ModelSettings,
  role: ModelRole,
  ref: ModelRef | undefined,
): ModelSettings {
  const roles = { ...settings.roles };
  if (ref === undefined) {
    delete roles[role];
    return { services: settings.services, roles };
  }
  const service = settings.services.find((s) => s.id === ref.serviceId);
  if (service === undefined) throw new Error(`no service "${ref.serviceId}"`);
  if (!service.models.includes(ref.model)) {
    throw new Error(
      `service "${service.id}" has no model "${ref.model}" (has: ${service.models.join(", ")})`,
    );
  }
  roles[role] = { serviceId: ref.serviceId, model: ref.model };
  return { services: settings.services, roles };
}

/** The service and model chosen for a role, if any. */
export function modelFor(
  settings: ModelSettings,
  role: ModelRole,
): { service: ModelService; model: string } | undefined {
  const ref = settings.roles[role];
  if (ref === undefined) return undefined;
  const service = settings.services.find((s) => s.id === ref.serviceId);
  if (service === undefined || !service.models.includes(ref.model)) return undefined;
  return { service, model: ref.model };
}

function pruneRoles(settings: ModelSettings): ModelSettings {
  const roles: Partial<Record<ModelRole, ModelRef>> = {};
  for (const role of MODEL_ROLES) {
    const ref = settings.roles[role];
    if (ref === undefined) continue;
    const service = settings.services.find((s) => s.id === ref.serviceId);
    if (service?.models.includes(ref.model)) roles[role] = ref;
  }
  return { services: settings.services, roles };
}
