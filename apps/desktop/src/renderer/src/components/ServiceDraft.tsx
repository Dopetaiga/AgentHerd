// Adding a model service, in three parts: the service, then the key, then the models (ADR 0021).
// The state lives in `useServiceDraft`; the 添加服务 dialog and the first run lay out the parts.

import type { ProviderView } from "@agentherd/host/api";
import { Check, ChevronRight, Globe, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { applyModels, call, type ModelService, useApp } from "../store";
import { parseModelList, providerName, slugify, uniqueId } from "./labels";
import { ModelChecklist, ModelTextList } from "./ModelPicker";
import { Field, Group, IconTile, inputClass } from "./ui";

export type ServiceChoice = { kind: "builtin"; provider: ProviderView } | { kind: "custom" };

const SERVICE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

function sameChoice(a: ServiceChoice | null, b: ServiceChoice): boolean {
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
  const [baseUrl, setBaseUrl] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [modelText, setModelText] = useState("");
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
    }
    setIdEdited(false);
    setPicked([]);
  };

  const onName = (value: string) => {
    setName(value);
    if (!idEdited) setIdValue(value.trim() === "" ? "" : uniqueId(slugify(value), takenIds));
  };

  const setId = (value: string) => {
    setIdValue(value.trim());
    setIdEdited(true);
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

  /** Checks the key step; shows the problem and returns false if there is one. */
  const checkDetails = (): boolean => {
    const problem = detailsProblem();
    setError(problem);
    return problem === null;
  };

  const models = choice?.kind === "custom" ? parseModelList(modelText) : picked;

  /** Saves the service. Returns true when the host took it. */
  const save = async (): Promise<boolean> => {
    if (choice === null) return false;
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
    modelText,
    setModelText,
    models,
    error,
    setError,
    checkDetails,
    saving,
    save,
  };
}

export type ServiceDraft = ReturnType<typeof useServiceDraft>;

/**
 * The services to choose from. "navigate" rows end in a chevron and move on when clicked;
 * "select" rows mark the chosen one and wait for 继续.
 */
export function ProviderChoiceList({
  draft,
  mode,
  listClassName = "max-h-[340px]",
  onPicked,
}: {
  draft: ServiceDraft;
  mode: "navigate" | "select";
  listClassName?: string;
  /** Runs after a click on a row chose its service. */
  onPicked?: () => void;
}) {
  const choose = (c: ServiceChoice) => {
    draft.pick(c);
    onPicked?.();
  };
  const selected = (c: ServiceChoice) => mode === "select" && sameChoice(draft.choice, c);
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search size={14} className="absolute top-[9px] left-2.5 text-ink-dim" />
        <input
          autoFocus={mode === "navigate"}
          className={`${inputClass} pl-8`}
          placeholder="搜索服务商"
          value={draft.query}
          onChange={(e) => draft.setQuery(e.target.value)}
        />
      </div>
      <Group className={`overflow-y-auto ${listClassName}`}>
        {draft.shown.map((p) => {
          const c: ServiceChoice = { kind: "builtin", provider: p };
          return (
            <ChoiceRow
              key={p.provider}
              mode={mode}
              selected={selected(c)}
              icon={
                <span className="font-semibold text-sm">
                  {providerName(p.provider).slice(0, 1)}
                </span>
              }
              title={providerName(p.provider)}
              subtitle={`${p.provider} · ${p.models.length} 个模型`}
              onClick={() => choose(c)}
            />
          );
        })}
        <ChoiceRow
          mode={mode}
          selected={selected({ kind: "custom" })}
          icon={<Globe size={15} strokeWidth={1.75} />}
          title="OpenAI 兼容地址"
          subtitle="第三方、中转或本地 Ollama：填写 Base URL 和模型 ID"
          onClick={() => choose({ kind: "custom" })}
        />
        {draft.shown.length === 0 && (
          <div className="px-3 py-4 text-center text-ink-muted text-sm">没有匹配的服务商</div>
        )}
      </Group>
    </div>
  );
}

function ChoiceRow({
  mode,
  selected,
  icon,
  title,
  subtitle,
  onClick,
}: {
  mode: "navigate" | "select";
  selected: boolean;
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={mode === "select" ? selected : undefined}
      onClick={onClick}
      className={`flex min-h-13 w-full items-center gap-3 px-3.5 py-2 text-left ${
        selected ? "bg-control-hover" : "hover:bg-hover"
      }`}
    >
      <IconTile tone={selected ? "blue" : "gray"}>{icon}</IconTile>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{title}</span>
        <span className="block truncate text-ink-muted text-sm">{subtitle}</span>
      </span>
      {mode === "navigate" ? (
        <ChevronRight size={15} className="text-ink-dim" />
      ) : selected ? (
        <Check size={16} className="text-accent-text" />
      ) : null}
    </button>
  );
}

/** The key step: the API key, and for a custom service its name and address. */
export function ServiceKeyFields({
  draft,
  showId = true,
}: {
  draft: ServiceDraft;
  /** The first run hides the ID and the name of a built-in service; their defaults are fine. */
  showId?: boolean;
}) {
  const custom = draft.choice?.kind === "custom";
  return (
    <div className="flex flex-col gap-4">
      {custom && (
        <>
          <Field label="名称">
            <input
              autoFocus
              className={inputClass}
              placeholder="例如：公司网关"
              value={draft.name}
              onChange={(e) => draft.onName(e.target.value)}
            />
          </Field>
          <Field label="Base URL" hint="通常以 /v1 结尾。本地 Ollama：http://localhost:11434/v1">
            <input
              className={`${inputClass} font-mono`}
              placeholder="https://host/v1"
              value={draft.baseUrl}
              onChange={(e) => draft.setBaseUrl(e.target.value)}
            />
          </Field>
        </>
      )}
      <Field
        label="API Key"
        hint={
          custom
            ? "只保存在本机钥匙串，保存后不再显示。本地服务可留空。"
            : "只保存在本机钥匙串，保存后不再显示。留空则使用环境变量。"
        }
      >
        <input
          autoFocus={!custom}
          type="password"
          autoComplete="off"
          className={`${inputClass} font-mono`}
          placeholder="sk-…"
          value={draft.key}
          onChange={(e) => draft.setKey(e.target.value)}
        />
      </Field>
      {showId && (
        <Field label="ID" hint="用于引用这个服务，例如 主管模型 = ID/模型。小写字母、数字和 -。">
          <input
            className={`${inputClass} font-mono`}
            value={draft.id}
            onChange={(e) => draft.setId(e.target.value)}
          />
        </Field>
      )}
      {showId && !custom && (
        <Field label="名称">
          <input
            className={inputClass}
            value={draft.name}
            onChange={(e) => draft.setName(e.target.value)}
          />
        </Field>
      )}
    </div>
  );
}

/** The models step: a checklist for a built-in service, a text list for a custom one. */
export function ServiceModelFields({ draft }: { draft: ServiceDraft }) {
  const choice = draft.choice;
  if (choice === null) return null;
  return choice.kind === "builtin" ? (
    <ModelChecklist
      options={choice.provider.models}
      selected={draft.picked}
      onChange={draft.setPicked}
    />
  ) : (
    <ModelTextList text={draft.modelText} onChange={draft.setModelText} />
  );
}
