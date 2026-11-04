// 设置: mode, keep awake, and where AgentHerd keeps its files.

import type { SettingsPatch } from "@agentherd/host/api";
import { useState } from "react";
import { Card, SectionTitle, Switch } from "../components/ui";
import { call, type Mode, useApp } from "../store";

const MODES: { mode: Mode; title: string; hint: string }[] = [
  { mode: "observe", title: "只观察", hint: "只建议，不自动批准" },
  { mode: "assist", title: "协助", hint: "按规则自动批准" },
];

export function SettingsPage() {
  const status = useApp((s) => s.status);
  const [busy, setBusy] = useState(false);

  const update = async (patch: SettingsPatch) => {
    setBusy(true);
    const next = await call((h) => h.updateSettings(patch));
    if (next !== undefined) useApp.setState({ status: next });
    setBusy(false);
  };

  if (status === undefined) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionTitle>模式</SectionTitle>
        <Card className="flex flex-col gap-1 p-2">
          {MODES.map(({ mode, title, hint }) => (
            <label
              key={mode}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
            >
              <input
                type="radio"
                name="mode"
                className="accent-blue-600"
                checked={status.mode === mode}
                disabled={busy}
                onChange={() => void update({ mode })}
              />
              <span>
                <span className="block text-sm text-zinc-900 dark:text-zinc-100">{title}</span>
                <span className="block text-xs text-zinc-500">{hint}</span>
              </span>
            </label>
          ))}
          {!MODES.some((m) => m.mode === status.mode) && (
            <p className="px-2 py-1 text-xs text-zinc-500">当前模式：{status.mode}</p>
          )}
        </Card>
      </div>

      <div>
        <SectionTitle>电源</SectionTitle>
        <Card className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-zinc-900 dark:text-zinc-100">防止休眠</div>
            <div className="text-xs text-zinc-500">
              有任务在跑时让电脑保持唤醒，合上盖子也能继续
            </div>
          </div>
          <Switch
            label="防止休眠"
            checked={status.keepAwake}
            disabled={busy}
            onChange={(keepAwake) => void update({ keepAwake })}
          />
        </Card>
      </div>

      <div>
        <SectionTitle>关于</SectionTitle>
        <Card className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
          <span className="text-zinc-500">数据目录</span>
          <span className="selectable break-all font-mono text-xs leading-5 text-zinc-800 dark:text-zinc-200">
            {status.home}
          </span>
          <span className="text-zinc-500">版本</span>
          <span className="selectable font-mono text-xs leading-5 text-zinc-800 dark:text-zinc-200">
            {status.version}
          </span>
        </Card>
      </div>
    </div>
  );
}
