// Choosing a model from the list for a role (ADR 0021): the select itself, and the 审查员 row of
// the 模型 page. The 主管 page uses the select in its own rows.

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { applyModels, call, type ModelRef, type ModelRole, useApp } from "../store";
import { Group, inputClass, Row } from "./ui";

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

/** A select over every listed model; picking one saves it for the role right away. */
export function RoleSelect({
  modelRole,
  label,
  className = "w-60",
  onChosen,
}: {
  modelRole: ModelRole;
  label: string;
  className?: string;
  /** Called after a choice was saved, with the new model (null for 不选). */
  onChosen?: (ref: ModelRef | null) => void;
}) {
  const models = useApp((s) => s.models);
  const [busy, setBusy] = useState(false);
  const services = models?.services ?? [];
  const ref = models?.roles[modelRole];
  const current = ref === undefined ? NONE : encode(ref);
  const listed = services.some((s) => s.id === ref?.serviceId && s.models.includes(ref.model));

  const choose = async (value: string) => {
    const next = decode(value);
    setBusy(true);
    const view = await call((h) => h.chooseModel(modelRole, next));
    setBusy(false);
    if (view === undefined) return;
    applyModels(view);
    onChosen?.(next);
  };

  return (
    <span className="relative block">
      <select
        aria-label={label}
        className={`${inputClass} ${className} ${current === NONE ? "text-ink-muted" : ""}`}
        value={current}
        disabled={busy || models === undefined}
        onChange={(e) => void choose(e.target.value)}
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
      {busy && (
        <Loader2
          size={12}
          className="-left-5 absolute top-1/2 -translate-y-1/2 animate-spin text-ink-muted"
        />
      )}
    </span>
  );
}

/** The "用途" group of the 模型 page. */
export function RolePicker() {
  const count = useApp((s) => s.models?.services.length ?? 0);
  return (
    <Group>
      <Row
        className="min-h-14"
        title="审查员"
        description="最强的模型，负责审查有风险的请求"
        trailing={<RoleSelect modelRole="reviewer" label="审查员的模型" />}
      />
      {count === 0 && (
        <div className="bg-warning-soft/40 px-4 py-2.5 text-sm text-warning-text">
          还没有模型服务。先添加一个服务，再回来选模型。
        </div>
      )}
    </Group>
  );
}
