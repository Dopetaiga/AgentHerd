// 主管: the list of Herders and the model each one uses. The host has one Herder today; the page
// works from a list, so more can be added here when the host has them.

import type { HerderStatus, ModelTest } from "@agentherd/host/api";
import { Bot, Check, CircleAlert, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { herderReasonLabel } from "../components/labels";
import { ModelTiers } from "../components/ModelTiers";
import { RoleSelect } from "../components/RolePicker";
import { Button, Dot, Group, IconTile, Row } from "../components/ui";
import { call, type ModelRef, type ModelRole, useApp } from "../store";

interface Herder {
  id: string;
  name: string;
  /** The model role this Herder takes its model from. */
  role: ModelRole;
  status: HerderStatus;
}

function HerderRow({ herder }: { herder: Herder }) {
  const ref = useApp((s) => s.models?.roles[herder.role]);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ModelTest | null>(null);
  const { name, role, status } = herder;

  const test = async (target: ModelRef) => {
    setTesting(true);
    setResult(null);
    const outcome = await call((h) => h.testModel(target));
    setTesting(false);
    if (outcome !== undefined) setResult(outcome);
  };

  return (
    <div>
      <Row
        className="min-h-16"
        icon={
          <IconTile tone={status.on ? "green" : "gray"}>
            <Bot size={15} strokeWidth={1.75} />
          </IconTile>
        }
        title={
          <span className="flex items-center gap-2">
            {name}
            <Dot tone={status.on ? "green" : "gray"} />
            <span className="font-normal text-ink-muted text-sm">
              {status.on ? "工作中" : "已关闭"}
            </span>
          </span>
        }
        description={
          status.on ? (
            <span className="selectable font-mono">{status.ref}</span>
          ) : (
            herderReasonLabel(status.reason)
          )
        }
        trailing={
          <>
            <RoleSelect
              modelRole={role}
              label={`${name}的模型`}
              className="w-52"
              onChosen={(next) => {
                setResult(null);
                if (next !== null) void test(next);
              }}
            />
            <Button
              disabled={ref === undefined || testing}
              onClick={() => {
                if (ref !== undefined) void test(ref);
              }}
            >
              试一下
            </Button>
          </>
        }
      />
      {(testing || result !== null) && (
        <div className="flex items-start gap-1.5 px-4 pb-3 pl-14 text-sm">
          {testing && (
            <>
              <Loader2 size={13} className="mt-[3px] shrink-0 animate-spin text-ink-muted" />
              <span className="text-ink-muted">正在试一下…</span>
            </>
          )}
          {result?.ok === true && (
            <>
              <Check size={13} className="mt-[3px] shrink-0 text-success-text" />
              <span className="selectable min-w-0 break-words text-ink-2">{result.reply}</span>
            </>
          )}
          {result?.ok === false && (
            <>
              <CircleAlert size={13} className="mt-[3px] shrink-0 text-danger-text" />
              <span className="selectable min-w-0 break-words text-danger-text">
                {result.message}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function HerdersPage() {
  const status = useApp((s) => s.status);
  const serviceCount = useApp((s) => s.models?.services.length ?? 0);
  const setPage = useApp((s) => s.setPage);
  if (status === undefined) return null;
  const herders: Herder[] = [{ id: "main", name: "主管", role: "herder", status: status.herder }];

  return (
    <div className="flex flex-col gap-3">
      <Group>
        {herders.map((h) => (
          <HerderRow key={h.id} herder={h} />
        ))}
        {serviceCount === 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-ink-muted text-sm">
            还没有模型服务，先添加一个才能选模型。
            <Button size="sm" onClick={() => setPage("models")}>
              去添加
            </Button>
          </div>
        )}
      </Group>
      <div className="flex items-center gap-1">
        <Button variant="ghost" disabled className="pl-1">
          <Plus size={14} /> 添加主管
        </Button>
        <span className="text-ink-dim text-sm">以后支持多个主管</span>
      </div>
      <ModelTiers />
    </div>
  );
}
