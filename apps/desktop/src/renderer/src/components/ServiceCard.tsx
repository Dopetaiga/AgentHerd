// One model service: its models (with a per-model test), key, edit and delete actions.

import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { useState } from "react";
import { devOpen } from "../dev-bridge";
import { applyModels, call, errorText, host, type ServiceView, useApp } from "../store";
import { providerName } from "./labels";
import { Modal } from "./Modal";
import { ModelPanes } from "./ModelPanes";
import { ProbeButton, useModelProbe } from "./ModelProbe";
import { FieldNote, SmallField } from "./ServiceForm";
import { Badge, Button, Dot, Group, IconTile, inputClass } from "./ui";

type TestResult =
  | { state: "running" }
  | { state: "ok"; text: string }
  | { state: "error"; text: string };

export function ServiceCard({ service }: { service: ServiceView }) {
  const [editing, setEditing] = useState(() => devOpen() === `edit-${service.id}`);
  const [armedDelete, setArmedDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    applyModels(await call((h) => h.removeService(service.id)));
    setBusy(false);
    setArmedDelete(false);
  };

  const where =
    service.kind === "builtin" ? providerName(service.provider ?? "") : (service.baseUrl ?? "");

  return (
    <>
      <Group>
        <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
          <IconTile tone={service.kind === "builtin" ? "blue" : "gray"}>
            <span className="font-semibold text-sm">{service.name.slice(0, 1).toUpperCase()}</span>
          </IconTile>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-medium text-ink">{service.name}</h3>
              <Badge>
                {service.kind === "builtin"
                  ? "内置服务商"
                  : service.api === "anthropic-messages"
                    ? "Anthropic 兼容"
                    : "OpenAI 兼容"}
              </Badge>
            </div>
            <div className="selectable mt-0.5 flex min-w-0 items-center gap-1.5 text-ink-muted text-sm">
              <span className="truncate">{where}</span>
              <span className="text-ink-dim">·</span>
              <span className="shrink-0">{service.models.length} 个模型</span>
              <span className="text-ink-dim">·</span>
              <span className="flex shrink-0 items-center gap-1">
                <Dot tone={service.hasKey ? "green" : "amber"} />
                {service.hasKey ? "Key 已保存" : "Key 未保存"}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {armedDelete ? (
              <>
                <Button variant="danger" onClick={remove} disabled={busy}>
                  确定删除
                </Button>
                <Button variant="ghost" onClick={() => setArmedDelete(false)}>
                  取消
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  编辑
                </Button>
                <Button variant="ghost" onClick={() => setArmedDelete(true)}>
                  删除
                </Button>
              </>
            )}
          </div>
        </div>
      </Group>
      {editing && <EditModelsDialog service={service} onClose={() => setEditing(false)} />}
    </>
  );
}

/** Tests one model with the saved key and shows the result inline. */
function TestModel({ serviceId, model }: { serviceId: string; model: string }) {
  const [result, setResult] = useState<TestResult | null>(null);
  const run = async () => {
    setResult({ state: "running" });
    try {
      const r = await host().testModel({ serviceId, model });
      setResult(r.ok ? { state: "ok", text: r.reply } : { state: "error", text: r.message });
    } catch (error) {
      setResult({ state: "error", text: errorText(error) });
    }
  };
  return (
    <>
      {result?.state === "ok" && (
        <span
          className="flex min-w-0 items-center gap-1 text-sm text-success-text"
          title={result.text}
        >
          <CheckCircle2 size={13} className="shrink-0" />
          可用
        </span>
      )}
      {result?.state === "error" && (
        <span
          className="flex min-w-0 items-center gap-1 text-danger-text text-sm"
          title={result.text}
        >
          <XCircle size={13} className="shrink-0" />
          <span className="max-w-48 truncate">{result.text}</span>
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void run()}
        disabled={result?.state === "running"}
      >
        {result?.state === "running" ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Play size={12} />
        )}
        测试
      </Button>
    </>
  );
}

/** Edits a saved service: its key and its models, in the same form as adding one. */
function EditModelsDialog({ service, onClose }: { service: ServiceView; onClose: () => void }) {
  const providers = useApp((s) => s.providers);
  const catalog =
    service.kind === "builtin"
      ? (providers.find((p) => p.provider === service.provider)?.models ?? [])
      : [];
  const [picked, setPicked] = useState<string[]>(service.models);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const probe = useModelProbe();
  const custom = service.kind === "openai-compatible";
  // 探测模型 may find the list under <address>/v1; saving then fixes the address too.
  const [baseUrl, setBaseUrl] = useState(service.baseUrl);
  const problem = picked.length === 0 ? "至少选一个模型" : null;

  const save = async () => {
    setSaving(true);
    const { hasKey: _hasKey, ...plain } = service;
    // An empty key keeps the saved key.
    const result = await call((h) =>
      h.putService(
        { ...plain, models: picked, ...(custom && baseUrl !== undefined ? { baseUrl } : {}) },
        key === "" ? undefined : key,
      ),
    );
    setSaving(false);
    if (result !== undefined) {
      applyModels(result);
      onClose();
    }
  };

  return (
    <Modal
      size="large"
      title={`编辑 ${service.name}`}
      description={
        <span className="font-mono">
          {service.kind === "builtin" ? providerName(service.provider ?? "") : baseUrl}
        </span>
      }
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={saving || problem !== null}
            title={problem ?? undefined}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}保存
          </Button>
        </>
      }
    >
      <div className="shrink-0">
        <SmallField label="API Key">
          <input
            type="password"
            autoComplete="off"
            className={`${inputClass} font-mono`}
            placeholder={service.hasKey ? "已保存，留空不修改" : "sk-…（留空则不保存 Key）"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </SmallField>
      </div>
      <FieldNote
        error={probe.error}
        hint={probe.note ?? "「测试」用已保存的 Key。去掉的模型如果正被使用，对应用途会被清空。"}
      />
      <ModelPanes
        options={custom ? probe.models : catalog}
        selected={picked}
        onChange={setPicked}
        disabled={saving}
        rowExtra={(id) => <TestModel serviceId={service.id} model={id} />}
        headerAction={
          custom ? (
            <ProbeButton
              running={probe.running}
              disabled={saving}
              title="从服务的 /models 接口读取模型列表；Key 留空时用已保存的"
              onClick={async () => {
                const r = await probe.probe({
                  serviceId: service.id,
                  ...(key.trim() === "" ? {} : { key: key.trim() }),
                });
                if (r?.ok === true && r.baseUrl !== undefined) setBaseUrl(r.baseUrl);
              }}
            />
          ) : undefined
        }
      />
    </Modal>
  );
}
