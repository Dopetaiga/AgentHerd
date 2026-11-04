// The "用途" card: choose a model from the list for each role (ADR 0021).

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { applyModels, call, type ModelRef, type ModelRole, useApp } from "../store";
import { inputClass } from "./ui";

const ROLES: { role: ModelRole; title: string; hint: string }[] = [
  { role: "herder", title: "主管", hint: "快一点的模型，负责跟进任务、回答你" },
  { role: "reviewer", title: "审查员", hint: "最强的模型，负责审查有风险的请求" },
];

const NONE = "";

function encode(ref: ModelRef): string {
  return JSON.stringify([ref.serviceId, ref.model]);
}

function decode(value: string): ModelRef | null {
  if (value === NONE) return null;
  const parsed: unknown = JSON.parse(value);
  if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
    return { serviceId: parsed[0], model: parsed[1] };
  }
  return null;
}

export function RolePicker() {
  const models = useApp((s) => s.models);
  const [busy, setBusy] = useState<ModelRole | null>(null);
  const services = models?.services ?? [];

  const choose = async (role: ModelRole, value: string) => {
    setBusy(role);
    applyModels(await call((h) => h.chooseModel(role, decode(value))));
    setBusy(null);
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {ROLES.map(({ role, title, hint }) => {
        const ref = models?.roles[role];
        const current = ref === undefined ? NONE : encode(ref);
        const listed = services.some(
          (s) => s.id === ref?.serviceId && s.models.includes(ref.model),
        );
        return (
          <label key={role} className="block">
            <span className="mb-1 flex items-center gap-1.5 font-medium text-sm text-zinc-800 dark:text-zinc-100">
              {title}
              {busy === role && <Loader2 size={12} className="animate-spin text-zinc-400" />}
            </span>
            <select
              className={inputClass}
              value={current}
              disabled={busy !== null || models === undefined}
              onChange={(e) => void choose(role, e.target.value)}
            >
              <option value={NONE}>不选</option>
              {ref !== undefined && !listed && (
                <option value={current}>
                  {ref.serviceId} / {ref.model}
                </option>
              )}
              {services.map((s) => (
                <optgroup key={s.id} label={s.name}>
                  {s.models.map((m) => (
                    <option key={m} value={encode({ serviceId: s.id, model: m })}>
                      {s.name} / {m}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="mt-1 block text-xs text-zinc-500">{hint}</span>
          </label>
        );
      })}
      {services.length === 0 && (
        <p className="text-xs text-amber-600 sm:col-span-2 dark:text-amber-400">
          还没有模型服务。先添加一个服务，再回来选模型。
        </p>
      )}
    </div>
  );
}
