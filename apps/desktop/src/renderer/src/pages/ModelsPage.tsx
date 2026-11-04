// 模型: the model used for reviews, and the list of model services (ADR 0021).
// The Herder's model is chosen on the 主管 page.

import { Boxes, Plus } from "lucide-react";
import { useState } from "react";
import { AddServiceDialog } from "../components/AddServiceDialog";
import { RolePicker } from "../components/RolePicker";
import { ServiceCard } from "../components/ServiceCard";
import { Button, EmptyState, Group, Section } from "../components/ui";
import { useApp } from "../store";

/** The service list with an "添加服务" button; also used inside onboarding. */
export function ServiceList() {
  const services = useApp((s) => s.models?.services);
  const [adding, setAdding] = useState(false);
  const list = [...(services ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const add = (
    <Button variant={list.length === 0 ? "primary" : "secondary"} onClick={() => setAdding(true)}>
      <Plus size={14} /> 添加服务
    </Button>
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
      {adding && <AddServiceDialog onClose={() => setAdding(false)} />}
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
