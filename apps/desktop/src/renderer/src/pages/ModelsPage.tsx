// 模型: the model used for reviews, and the list of model services (ADR 0021).
// The Herder's model is chosen on the 主管 page.

import { Boxes, Download, Plus } from "lucide-react";
import { useState } from "react";
import { AddServiceDialog } from "../components/AddServiceDialog";
import { RolePicker } from "../components/RolePicker";
import { ServiceCard } from "../components/ServiceCard";
import { Button, EmptyState, Group, Section } from "../components/ui";
import { devOpen } from "../dev-bridge";
import { applyModels, call, useApp } from "../store";

/** The dialog a dev preview asks for (`?open=` with the fake bridge); none in the app. */
function previewAdd(): { provider?: string; models?: string[] } | null {
  const open = devOpen();
  if (open === "add-service") return {};
  if (open === "add-custom") return { provider: "custom" };
  if (open === "add-builtin")
    return {
      provider: "openrouter",
      models: [
        "anthropic/claude-sonnet-4.5",
        "openai/gpt-5",
        "qwen/qwen3-coder",
        "my-private-model",
      ],
    };
  return null;
}

/** The service list with an "添加服务" button; also used inside onboarding. */
export function ServiceList() {
  const services = useApp((s) => s.models?.services);
  const [preview] = useState(previewAdd);
  const [adding, setAdding] = useState(preview !== null);
  const [importing, setImporting] = useState(false);
  const list = [...(services ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const importPi = async () => {
    setImporting(true);
    const r = await call((h) => h.importPiDesktop());
    setImporting(false);
    if (r === undefined) return;
    applyModels(r.models);
    const parts = [
      r.added.length > 0 ? `新增 ${r.added.join("、")}` : "",
      r.merged.length > 0 ? `补充了 ${r.merged.join("、")} 的模型` : "",
      r.skipped.length > 0
        ? `跳过 ${r.skipped.map((s) => s.name).join("、")}（用账号登录，没有 Key）`
        : "",
    ].filter((p) => p !== "");
    useApp
      .getState()
      .toast(parts.length > 0 ? parts.join("；") : "PI-Desktop 里没有可导入的服务", "info");
  };
  const add = (
    <div className="flex gap-2">
      <Button variant="secondary" disabled={importing} onClick={() => void importPi()}>
        <Download size={14} /> {importing ? "导入中…" : "从 PI-Desktop 导入"}
      </Button>
      <Button variant={list.length === 0 ? "primary" : "secondary"} onClick={() => setAdding(true)}>
        <Plus size={14} /> 添加服务
      </Button>
    </div>
  );
  return (
    <Section
      title="模型服务"
      hint="Key 只保存在本机，保存后不再显示"
      actions={list.length > 0 ? add : undefined}
    >
      {list.length === 0 ? (
        <Group>
          <EmptyState
            icon={<Boxes size={18} strokeWidth={1.75} />}
            title="还没有模型服务"
            text="添加一个服务商（比如 DeepSeek），或一个 OpenAI 兼容地址。"
            action={add}
          />
        </Group>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      )}
      {adding && (
        <AddServiceDialog
          onClose={() => setAdding(false)}
          initialProvider={preview?.provider}
          initialModels={preview?.models}
        />
      )}
    </Section>
  );
}

export function ModelsPage() {
  return (
    <div className="flex flex-col gap-7">
      <Section title="用途" hint="主管用的模型在「主管」页选">
        <RolePicker />
      </Section>
      <ServiceList />
    </div>
  );
}
