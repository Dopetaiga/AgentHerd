// One model service: its models (with a per-model test), key, edit and delete actions.

import { CheckCircle2, KeyRound, ListChecks, Loader2, Play, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { applyModels, call, errorText, host, type ServiceView, useApp } from "../store";
import { parseModelList, providerName } from "./labels";
import { ModelChecklist, ModelTextList } from "./ModelPicker";
import { Badge, Button, Card, inputClass, Modal } from "./ui";

type TestResult =
  | { state: "running" }
  | { state: "ok"; text: string }
  | { state: "error"; text: string };

export function ServiceCard({ service }: { service: ServiceView }) {
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
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
    <Card>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
              {service.name}
            </h3>
            <span className="font-mono text-xs text-zinc-500">{service.id}</span>
            <Badge tone={service.kind === "builtin" ? "blue" : "gray"}>
              {service.kind === "builtin" ? "内置服务商" : "OpenAI 兼容"}
            </Badge>
            <Badge tone={service.hasKey ? "green" : "amber"}>
              {service.hasKey ? "Key 已保存" : "Key 未保存"}
            </Badge>
          </div>
          <div className="selectable mt-0.5 truncate font-mono text-xs text-zinc-500">{where}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setKeyOpen((v) => !v)}>
            <KeyRound size={13} /> 更换 Key
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <ListChecks size={13} /> 编辑模型
          </Button>
          {armedDelete ? (
            <>
              <Button size="sm" variant="danger" onClick={remove} disabled={busy}>
                确定删除
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setArmedDelete(false)}>
                取消
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setArmedDelete(true)}>
              <Trash2 size={13} /> 删除
            </Button>
          )}
        </div>
      </div>

      {keyOpen && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/50">
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
          <Button size="sm" variant="primary" onClick={saveKey} disabled={busy}>
            保存
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setKey("");
              setKeyOpen(false);
            }}
          >
            取消
          </Button>
        </div>
      )}

      <ul className="mt-3 flex flex-col gap-1.5">
        {service.models.map((m) => {
          const t = tests[m];
          return (
            <li key={m} className="flex min-w-0 items-center gap-2">
              <span className="selectable truncate rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {m}
              </span>
              <button
                type="button"
                onClick={() => void test(m)}
                disabled={t?.state === "running"}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-60 dark:text-blue-400 dark:hover:bg-blue-950"
              >
                {t?.state === "running" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Play size={12} />
                )}
                测试
              </button>
              {t?.state === "ok" && (
                <span className="selectable flex min-w-0 items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={12} className="shrink-0" />
                  <span className="truncate">可用：{t.text}</span>
                </span>
              )}
              {t?.state === "error" && (
                <span className="selectable flex min-w-0 items-center gap-1 text-xs text-red-600 dark:text-red-400">
                  <XCircle size={12} className="shrink-0" />
                  <span className="truncate" title={t.text}>
                    {t.text}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {editing && <EditModelsDialog service={service} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function EditModelsDialog({ service, onClose }: { service: ServiceView; onClose: () => void }) {
  const providers = useApp((s) => s.providers);
  const catalog = providers.find((p) => p.provider === service.provider)?.models;
  const [picked, setPicked] = useState<string[]>(service.models);
  const [text, setText] = useState(service.models.join("\n"));
  const [saving, setSaving] = useState(false);
  const useList = service.kind === "builtin" && catalog !== undefined;
  const models = useList ? picked : parseModelList(text);

  const save = async () => {
    setSaving(true);
    const { hasKey: _hasKey, ...plain } = service;
    // `undefined` key keeps the saved key.
    const result = await call((h) => h.putService({ ...plain, models }, undefined));
    setSaving(false);
    if (result !== undefined) {
      applyModels(result);
      onClose();
    }
  };

  return (
    <Modal
      title={`编辑模型 · ${service.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs text-zinc-500">
            去掉的模型如果正被使用，对应用途会被清空。
          </span>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={save} disabled={saving || models.length === 0}>
            {saving && <Loader2 size={14} className="animate-spin" />}保存
          </Button>
        </>
      }
    >
      {useList ? (
        <ModelChecklist options={catalog} selected={picked} onChange={setPicked} />
      ) : (
        <ModelTextList text={text} onChange={setText} />
      )}
    </Modal>
  );
}
