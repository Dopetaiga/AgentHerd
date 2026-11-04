// "添加服务": choose the service first, then the key, then the models (ADR 0021).

import type { ProviderView } from "@agentherd/host/api";
import { ChevronRight, Globe, Loader2, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { applyModels, call, type ModelService, useApp } from "../store";
import { parseModelList, providerName, slugify, uniqueId } from "./labels";
import { ModelChecklist, ModelTextList } from "./ModelPicker";
import { Button, Field, inputClass, Modal } from "./ui";

type Choice = { kind: "builtin"; provider: ProviderView } | { kind: "custom" };

const SERVICE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function AddServiceDialog({ onClose }: { onClose: () => void }) {
  const providers = useApp((s) => s.providers);
  const services = useApp((s) => s.models?.services);
  const takenIds = (services ?? []).map((x) => x.id);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [query, setQuery] = useState("");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [modelText, setModelText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pick = (next: Choice) => {
    setChoice(next);
    setError(null);
    if (next.kind === "builtin") {
      const p = next.provider.provider;
      setName(providerName(p));
      setId(uniqueId(slugify(p), takenIds));
    } else {
      setName("");
      setId("");
    }
    setIdEdited(false);
    setPicked([]);
    setStep(2);
  };

  const onName = (value: string) => {
    setName(value);
    if (!idEdited) setId(value.trim() === "" ? "" : uniqueId(slugify(value), takenIds));
  };

  const checkStep2 = (): string | null => {
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

  const next = () => {
    const problem = checkStep2();
    setError(problem);
    if (problem === null) setStep(3);
  };

  const models = choice?.kind === "custom" ? parseModelList(modelText) : picked;

  const save = async () => {
    if (choice === null) return;
    if (models.length === 0) {
      setError("至少选一个模型");
      return;
    }
    const service: ModelService =
      choice.kind === "builtin"
        ? { id, name: name.trim(), kind: "builtin", provider: choice.provider.provider, models }
        : { id, name: name.trim(), kind: "openai-compatible", baseUrl: baseUrl.trim(), models };
    setSaving(true);
    setError(null);
    const result = await call((h) => h.putService(service, key === "" ? undefined : key));
    setSaving(false);
    if (result !== undefined) {
      applyModels(result);
      setKey("");
      onClose();
    }
  };

  const q = query.trim().toLowerCase();
  const shown = providers.filter(
    (p) => q === "" || p.provider.includes(q) || providerName(p.provider).toLowerCase().includes(q),
  );

  const title =
    step === 1
      ? "添加服务"
      : choice?.kind === "builtin"
        ? `添加 ${providerName(choice.provider.provider)}`
        : "添加 OpenAI 兼容服务";

  const footer =
    step === 1 ? (
      <Button onClick={onClose}>取消</Button>
    ) : (
      <>
        <span className="mr-auto text-xs text-zinc-500">第 {step - 1} / 2 步</span>
        <Button onClick={() => setStep(step === 3 ? 2 : 1)} disabled={saving}>
          上一步
        </Button>
        {step === 2 ? (
          <Button variant="primary" onClick={next}>
            下一步
          </Button>
        ) : (
          <Button variant="primary" onClick={save} disabled={saving || models.length === 0}>
            {saving && <Loader2 size={14} className="animate-spin" />}保存
          </Button>
        )}
      </>
    );

  return (
    <Modal title={title} onClose={onClose} footer={footer} wide>
      {step === 1 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">先选择模型服务。</p>
          <div className="relative">
            <Search size={14} className="absolute top-2.5 left-2.5 text-zinc-400" />
            <input
              autoFocus
              className={`${inputClass} pl-8`}
              placeholder="搜索服务商"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
            <ChoiceRow
              icon={<Globe size={16} />}
              title="OpenAI 兼容地址（第三方、中转、本地 Ollama）"
              subtitle="填写 Base URL 和模型 ID"
              onClick={() => pick({ kind: "custom" })}
            />
            {shown.map((p) => (
              <ChoiceRow
                key={p.provider}
                icon={
                  <span className="flex h-4 w-4 items-center justify-center font-semibold text-xs">
                    {providerName(p.provider).slice(0, 1)}
                  </span>
                }
                title={providerName(p.provider)}
                subtitle={`${p.provider} · ${p.models.length} 个模型`}
                onClick={() => pick({ kind: "builtin", provider: p })}
              />
            ))}
            {shown.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-zinc-500">没有匹配的服务商</div>
            )}
          </div>
        </div>
      )}

      {step === 2 && choice !== null && (
        <div className="flex flex-col gap-4">
          {choice.kind === "custom" && (
            <>
              <Field label="名称">
                <input
                  autoFocus
                  className={inputClass}
                  placeholder="例如：公司网关"
                  value={name}
                  onChange={(e) => onName(e.target.value)}
                />
              </Field>
              <Field
                label="Base URL"
                hint="通常以 /v1 结尾。本地 Ollama：http://localhost:11434/v1"
              >
                <input
                  className={`${inputClass} font-mono`}
                  placeholder="https://host/v1"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </Field>
            </>
          )}
          <Field
            label="API Key"
            hint={
              choice.kind === "builtin"
                ? "只保存在本机钥匙串，保存后不再显示。留空则使用环境变量。"
                : "只保存在本机钥匙串，保存后不再显示。本地服务可留空。"
            }
          >
            <input
              autoFocus={choice.kind === "builtin"}
              type="password"
              autoComplete="off"
              className={`${inputClass} font-mono`}
              placeholder="sk-…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </Field>
          <Field label="ID" hint="用于引用这个服务，例如 主管模型 = ID/模型。小写字母、数字和 -。">
            <input
              className={`${inputClass} font-mono`}
              value={id}
              onChange={(e) => {
                setId(e.target.value.trim());
                setIdEdited(true);
              }}
            />
          </Field>
          {choice.kind === "builtin" && (
            <Field label="名称">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}
          {error !== null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}

      {step === 3 && choice !== null && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">选择要启用的模型。</p>
          {choice.kind === "builtin" ? (
            <ModelChecklist
              options={choice.provider.models}
              selected={picked}
              onChange={setPicked}
            />
          ) : (
            <ModelTextList text={modelText} onChange={setModelText} />
          )}
          {error !== null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

function ChoiceRow({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-zinc-100 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-zinc-900 dark:text-zinc-100">{title}</span>
        <span className="block truncate text-xs text-zinc-500">{subtitle}</span>
      </span>
      <ChevronRight size={16} className="text-zinc-400" />
    </button>
  );
}
