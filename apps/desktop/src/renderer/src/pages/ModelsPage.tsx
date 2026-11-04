// 模型: choose a model per role, then manage the list of model services (ADR 0021).

import { Boxes, Plus } from "lucide-react";
import { useState } from "react";
import { AddServiceDialog } from "../components/AddServiceDialog";
import { RolePicker } from "../components/RolePicker";
import { ServiceCard } from "../components/ServiceCard";
import { Button, Card, EmptyState, SectionTitle } from "../components/ui";
import { useApp } from "../store";

/** The service list with an "添加服务" button; also used inside onboarding. */
export function ServiceList() {
  const services = useApp((s) => s.models?.services);
  const [adding, setAdding] = useState(false);
  const list = [...(services ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SectionTitle hint="Key 只保存在本机，保存后不再显示">模型服务</SectionTitle>
        <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
          <Plus size={14} /> 添加服务
        </Button>
      </div>
      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Boxes size={28} />}
            text="还没有模型服务。添加一个服务商（比如 DeepSeek），或一个 OpenAI 兼容地址。"
          />
        </Card>
      ) : (
        list.map((s) => <ServiceCard key={s.id} service={s} />)
      )}
      {adding && <AddServiceDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

export function ModelsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionTitle hint="从下面的模型列表里选">用途</SectionTitle>
        <Card>
          <RolePicker />
        </Card>
      </div>
      <ServiceList />
    </div>
  );
}
