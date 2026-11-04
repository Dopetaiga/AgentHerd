// `agentherd model ...`: the owner's model list until the desktop app has its settings page
// (ADR 0021). Keys are read from stdin and kept in the keychain, never in config.json.

import { parseArgs } from "node:util";
import {
  chooseModel,
  emptyModelSettings,
  formatModelRef,
  MODEL_ROLES,
  type ModelRole,
  type ModelService,
  type ModelSettings,
  modelKeyAccount,
  parseModelRef,
  putService,
  removeService,
  type SecretStore,
} from "@agentherd/core";
import { builtinProviders, resolveModel, serviceKey, testModel } from "@agentherd/herder";
import { readConfig, writeConfig } from "./config.ts";

export const MODEL_USAGE = `Usage: agentherd model <command>

  providers                          Providers that need only a key, with their models
  list                               Your services and the model of each role
  add <provider> [--id <id>] [--models a,b]
                                     Add a provider pi-ai knows; the key is read from stdin
  add-compatible <id> --base-url <url> --models a,b [--name <name>]
                                     Add an OpenAI-compatible endpoint; the key is read from stdin
  key <service>                      Replace the key of a service (stdin)
  use <herder|reviewer> <service>/<model>
                                     Choose the model of a role ("none" to clear)
  test <service>/<model>             Send one short request
  remove <service>                   Remove a service and its key
`;

type Out = (line: string) => void;

export interface ModelDeps {
  secrets: SecretStore;
  /** Reads a key; "" when none was given. */
  readKey: (prompt: string) => Promise<string>;
  env?: Record<string, string>;
}

function settingsOf(home: string): ModelSettings {
  return readConfig(home).models ?? emptyModelSettings();
}

function save(home: string, models: ModelSettings): void {
  writeConfig(home, { ...readConfig(home), models });
}

function list(items: string | undefined): string[] {
  return (items ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export async function modelCommand(
  home: string,
  args: string[],
  out: Out,
  deps: ModelDeps,
): Promise<number> {
  const [sub, ...rest] = args;
  try {
    switch (sub) {
      case "providers":
        for (const p of builtinProviders()) {
          out(`${p.provider}: ${p.models.map((m) => m.id).join(", ")}`);
        }
        return 0;
      case "list":
        return listServices(home, out, deps);
      case "add":
        return await addBuiltin(home, rest, out, deps);
      case "add-compatible":
        return await addCompatible(home, rest, out, deps);
      case "key": {
        const service = findService(settingsOf(home), rest[0]);
        const key = await deps.readKey(`Paste the key for ${service.id}, then Enter and Ctrl-D:`);
        if (key === "") deps.secrets.delete(modelKeyAccount(service.id));
        else deps.secrets.set(modelKeyAccount(service.id), key);
        out(key === "" ? `Removed the key of ${service.id}.` : `Saved the key of ${service.id}.`);
        return 0;
      }
      case "use": {
        const [role, ref] = rest;
        if (!MODEL_ROLES.includes(role as ModelRole) || ref === undefined) {
          out(MODEL_USAGE);
          return 2;
        }
        const next = chooseModel(
          settingsOf(home),
          role as ModelRole,
          ref === "none" ? undefined : parseModelRef(ref),
        );
        save(home, next);
        out(ref === "none" ? `No model for ${role}.` : `${role}: ${ref}`);
        return 0;
      }
      case "test": {
        const ref = parseModelRef(rest[0] ?? "");
        const service = findService(settingsOf(home), ref.serviceId);
        const result = await testModel(
          resolveModel(service, ref.model),
          serviceKey(service, deps.secrets, deps.env),
        );
        out(result.ok ? `OK: ${result.reply}` : `Failed: ${result.message}`);
        return result.ok ? 0 : 1;
      }
      case "remove": {
        const service = findService(settingsOf(home), rest[0]);
        save(home, removeService(settingsOf(home), service.id));
        deps.secrets.delete(modelKeyAccount(service.id));
        out(`Removed ${service.id}.`);
        return 0;
      }
      default:
        out(MODEL_USAGE);
        return 2;
    }
  } catch (error) {
    out(`Error: ${(error as Error).message}`);
    return 1;
  }
}

function findService(settings: ModelSettings, id: string | undefined): ModelService {
  const service = settings.services.find((s) => s.id === id);
  if (service === undefined)
    throw new Error(`no service "${id ?? ""}"; see "agentherd model list"`);
  return service;
}

function listServices(home: string, out: Out, deps: ModelDeps): number {
  const settings = settingsOf(home);
  if (settings.services.length === 0) out('No services. Add one with "agentherd model add".');
  for (const s of settings.services) {
    const where = s.kind === "builtin" ? s.provider : s.baseUrl;
    const key = serviceKey(s, deps.secrets, deps.env) === undefined ? "no key" : "key set";
    out(`${s.id}  (${s.name}, ${where}, ${key})  ${s.models.join(", ")}`);
  }
  for (const role of MODEL_ROLES) {
    const ref = settings.roles[role];
    out(`${role}: ${ref === undefined ? "-" : formatModelRef(ref)}`);
  }
  return 0;
}

async function addBuiltin(
  home: string,
  args: string[],
  out: Out,
  deps: ModelDeps,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { id: { type: "string" }, models: { type: "string" }, name: { type: "string" } },
  });
  const providerId = positionals[0];
  const provider = builtinProviders().find((p) => p.provider === providerId);
  if (provider === undefined) {
    throw new Error(`unknown provider "${providerId ?? ""}"; see "agentherd model providers"`);
  }
  const models = list(values.models);
  const service: ModelService = {
    id: values.id ?? provider.provider,
    name: values.name ?? provider.provider,
    kind: "builtin",
    provider: provider.provider,
    models: models.length > 0 ? models : provider.models.map((m) => m.id),
  };
  return finishAdd(home, service, out, deps);
}

async function addCompatible(
  home: string,
  args: string[],
  out: Out,
  deps: ModelDeps,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "base-url": { type: "string" },
      models: { type: "string" },
      name: { type: "string" },
    },
  });
  const id = positionals[0] ?? "";
  const service: ModelService = {
    id,
    name: values.name ?? id,
    kind: "openai-compatible",
    baseUrl: values["base-url"] ?? "",
    models: list(values.models),
  };
  return finishAdd(home, service, out, deps);
}

async function finishAdd(
  home: string,
  service: ModelService,
  out: Out,
  deps: ModelDeps,
): Promise<number> {
  const next = putService(settingsOf(home), service);
  const key = await deps.readKey(
    `Paste the key for ${service.id}, then Enter and Ctrl-D (empty: none or from the environment):`,
  );
  if (key !== "") deps.secrets.set(modelKeyAccount(service.id), key);
  save(home, next);
  out(`Added ${service.id}: ${service.models.join(", ")}`);
  if (next.roles.herder === undefined) {
    out(`Choose the Herder's model: agentherd model use herder ${service.id}/${service.models[0]}`);
  }
  return 0;
}
