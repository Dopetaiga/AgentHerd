// One model service: its models (with a per-model test), key, edit and delete actions.

import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { useState } from "react";
import { devOpen } from "../dev-bridge";
import { applyModels, call, errorText, host, type ServiceView, useApp } from "../store";
import { providerName } from "./labels";
import { Modal } from "./Modal";
import { ModelPanes } from "./ModelPanes";
import { FieldNote, SmallField } from "./ServiceForm";
import { Badge, Button, Dot, Group, IconTile, inputClass } from "./ui";

type TestResult =
  | { state: "running" }
  | { state: "ok"; text: string }
  | { state: "error"; text: string };

export function ServiceCard({ service }: { service: ServiceView }) {
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(() => devOpen() === `edit-${service.id}`);
  const [armedDelete, setArmedDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const test = async (model: string) => {
    setTests((t) => ({ ...t, [model]: { state: "running" } }));
    let result: TestResult;
    try {
      const r = await host().testModel({ serviceId: service.id, model });
      result = r.ok ? { state: "ok", text: r.reply } : { state: "error", text: r.message };
    } catch (error) {
      result = { state: "error", text: errorText(error) };
    }
    setTests((t) => ({ ...t, [model]: result }));
  };

  const saveKey = async () => {
    setBusy(true);
    const result = await call((h) => h.setKey(service.id, key));
    setBusy(false);
    if (result !== undefined) {
      applyModels(result);
      useApp.getState().toast(key === "" ? "Key 已删除" : "Key 已保存", "info");
      setKey("");
      setKeyOpen(false);
    }
  };

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
              <Badge>{service.kind === "builtin" ? "内置服务商" : "OpenAI 兼容"}</Badge>
            </div>
            <div className="selectable mt-0.5 flex min-w-0 items-center gap-1.5 text-ink-muted text-sm">
              <span className="shrink-0 font-mono">{service.id}</span>
              <span className="text-ink-dim">·</span>
              <span className="truncate">{where}</span>
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
                  编辑模型
                </Button>
                <Button variant="ghost" onClick={() => setArmedDelete(true)}>
                  删除
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex min-h-11 items-center gap-2 px-4 py-1.5">
          <Dot tone={service.hasKey ? "green" : "amber"} />
          <span className="flex-1 text-ink-2">{service.hasKey ? "Key 已保存" : "Key 未保存"}</span>
          {!keyOpen && (
            <Button variant="ghost" onClick={() => setKeyOpen(true)}>
              更换 Key
            </Button>
          )}
        </div>

        {keyOpen && (
          <div className="flex items-center gap-2 bg-inset px-4 py-2.5">
            <input
              type="password"
              autoFocus
              autoComplete="off"
              className={`${inputClass} font-mono`}
              placeholder="新的 API Key（留空并保存 = 删除已保存的 Key）"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveKey();
              }}
            />
            <Button variant="primary" onClick={saveKey} disabled={busy}>
              保存
            </Button>
            <Button
              onClick={() => {
                setKey("");
                setKeyOpen(false);
              }}
            >
              取消
            </Button>
          </div>
        )}

        {service.models.map((m) => {
          const t = tests[m];
          return (
            <div key={m} className="flex min-h-11 min-w-0 items-center gap-3 px-4 py-1.5">
              <span className="selectable shrink-0 truncate font-mono text-ink-2 text-sm">{m}</span>
              <span className="min-w-0 flex-1">
                {t?.state === "ok" && (
                  <span className="selectable flex min-w-0 items-center gap-1.5 text-sm text-success-text">
                    <CheckCircle2 size={13} className="shrink-0" />
                    <span className="truncate">可用：{t.text}</span>
                  </span>
                )}
                {t?.state === "error" && (
                  <span className="selectable flex min-w-0 items-center gap-1.5 text-danger-text text-sm">
                    <XCircle size={13} className="shrink-0" />
                    <span className="truncate" title={t.text}>
                      {t.text}
                    </span>
                  </span>
                )}
              </span>
              <Button
                variant="ghost"
                onClick={() => void test(m)}
                disabled={t?.state === "running"}
              >
                {t?.state === "running" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Play size={12} />
                )}
                测试
              </Button>
            </div>
          );
        })}
      </Group>
      {editing && <EditModelsDialog service={service} onClose={() => setEditing(false)} />}
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
  const problem = picked.length === 0 ? "至少选一个模型" : null;

  const save = async () => {
    setSaving(true);
    const { hasKey: _hasKey, ...plain } = service;
    // An empty key keeps the saved key.
    const result = await call((h) =>
      h.putService({ ...plain, models: picked }, key === "" ? undefined : key),
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
          {service.kind === "builtin" ? providerName(service.provider ?? "") : service.baseUrl}
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
      <FieldNote error={null} hint="去掉的模型如果正被使用，对应用途会被清空。" />
      <ModelPanes options={catalog} selected={picked} onChange={setPicked} disabled={saving} />
    </Modal>
  );
}
