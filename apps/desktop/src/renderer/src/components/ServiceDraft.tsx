// Adding a model service: the state and checks of the service being added (ADR 0021).
// `ServiceForm.tsx` lays it out: a chooser of services, then one form with the key and the
// models. The 添加服务 dialog and the first run both use them.

import type { ProviderView } from "@agentherd/host/api";
import { useState } from "react";
import { applyModels, call, type ModelService, useApp } from "../store";
import { providerName, slugify, uniqueId } from "./labels";

export type ServiceChoice = { kind: "builtin"; provider: ProviderView } | { kind: "custom" };

const SERVICE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function sameChoice(a: ServiceChoice | null, b: ServiceChoice): boolean {
  if (a === null || a.kind !== b.kind) return false;
  return (
    a.kind === "custom" || (b.kind === "builtin" && a.provider.provider === b.provider.provider)
  );
}

/** The service being added and its checks. */
export function useServiceDraft() {
  const providers = useApp((s) => s.providers);
  const services = useApp((s) => s.models?.services);
  const takenIds = (services ?? []).map((x) => x.id);
  const [choice, setChoice] = useState<ServiceChoice | null>(null);
  const [query, setQuery] = useState("");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [id, setIdValue] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [baseUrl, setBaseUrlValue] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  // Set once the owner typed a name, an ID or an address: problems show from then on.
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Chooses the service. Choosing the one already chosen keeps what was typed. */
  const pick = (next: ServiceChoice) => {
    setError(null);
    if (sameChoice(choice, next)) return;
    setChoice(next);
    if (next.kind === "builtin") {
      const p = next.provider.provider;
      setName(providerName(p));
      setIdValue(uniqueId(slugify(p), takenIds));
    } else {
      setName("");
      setIdValue("");
      setBaseUrlValue("");
    }
    setIdEdited(false);
    setTouched(false);
    setPicked([]);
  };

  const onName = (value: string) => {
    setName(value);
    setTouched(true);
    if (!idEdited) setIdValue(value.trim() === "" ? "" : uniqueId(slugify(value), takenIds));
  };

  const setId = (value: string) => {
    setIdValue(value.trim());
    setIdEdited(true);
    setTouched(true);
  };

  const setBaseUrl = (value: string) => {
    setBaseUrlValue(value);
    setTouched(true);
  };

  const detailsProblem = (): string | null => {
    if (name.trim() === "") return "请填写名称";
    if (!SERVICE_ID.test(id))
      return "ID 只能用小写字母、数字和 -，且以字母或数字开头（最多 40 个字符）";
    if (takenIds.includes(id)) return `ID “${id}” 已被使用`;
    if (choice?.kind === "custom") {
      try {
        const url = new URL(baseUrl.trim());
        if (url.protocol !== "https:" && url.protocol !== "http:")
          return "地址必须以 http 或 https 开头";
      } catch {
        return "请填写正确的地址，例如 https://host/v1";
      }
    }
    return null;
  };

  /** Checks the name, ID and address; shows the problem and returns false if there is one. */
  const checkDetails = (): boolean => {
    const problem = detailsProblem();
    setError(problem);
    return problem === null;
  };

  // Both kinds pick from a list; a custom service's list is the ids typed by hand.
  const models = picked;

  /** Why 保存 cannot run yet, or null. */
  const problem =
    choice === null
      ? "先选一个服务"
      : (detailsProblem() ?? (models.length === 0 ? "至少选一个模型" : null));

  /** Saves the service. Returns true when the host took it. */
  const save = async (): Promise<boolean> => {
    if (choice === null || !checkDetails()) return false;
    if (models.length === 0) {
      setError("至少选一个模型");
      return false;
    }
    const service: ModelService =
      choice.kind === "builtin"
        ? { id, name: name.trim(), kind: "builtin", provider: choice.provider.provider, models }
        : { id, name: name.trim(), kind: "openai-compatible", baseUrl: baseUrl.trim(), models };
    setSaving(true);
    setError(null);
    const result = await call((h) => h.putService(service, key === "" ? undefined : key));
    setSaving(false);
    if (result === undefined) return false;
    applyModels(result);
    setKey("");
    return true;
  };

  const q = query.trim().toLowerCase();
  const shown = providers.filter(
    (p) => q === "" || p.provider.includes(q) || providerName(p.provider).toLowerCase().includes(q),
  );

  const choiceName =
    choice?.kind === "builtin"
      ? providerName(choice.provider.provider)
      : choice?.kind === "custom"
        ? "OpenAI 兼容服务"
        : "";

  return {
    choice,
    choiceName,
    pick,
    query,
    setQuery,
    shown,
    key,
    setKey,
    name,
    setName,
    onName,
    id,
    setId,
    baseUrl,
    setBaseUrl,
    picked,
    setPicked,
    models,
    touched,
    error,
    setError,
    detailsProblem,
    checkDetails,
    problem,
    saving,
    save,
  };
}

export type ServiceDraft = ReturnType<typeof useServiceDraft>;
