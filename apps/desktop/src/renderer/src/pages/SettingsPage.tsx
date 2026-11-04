// 设置: the Feishu channel, the available agents, mode, keep awake, the first run, and where AgentHerd keeps its files.

import type { SettingsPatch } from "@agentherd/host/api";
import {
  Check,
  Eye,
  FolderOpen,
  Hand,
  Info,
  MoonStar,
  Rocket,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { FeishuSection } from "../components/FeishuSection";
import { Button, Group, IconTile, Row, Section, Switch } from "../components/ui";
import { call, type Mode, useApp } from "../store";

const MODES: { mode: Mode; title: string; hint: string; icon: typeof Eye }[] = [
  { mode: "observe", title: "只观察", hint: "只建议，不自动批准", icon: Eye },
  { mode: "assist", title: "协助", hint: "按规则自动批准", icon: Hand },
];

export function SettingsPage() {
  const status = useApp((s) => s.status);
  const openFirstRun = useApp((s) => s.openFirstRun);
  const [busy, setBusy] = useState(false);

  const update = async (patch: SettingsPatch) => {
    setBusy(true);
    const next = await call((h) => h.updateSettings(patch));
    if (next !== undefined) useApp.setState({ status: next });
    setBusy(false);
  };

  if (status === undefined) return null;

  return (
    <div className="flex flex-col gap-7">
      <FeishuSection />

      <Section title="Agent" hint="在飞书里用 /run 开始任务时可以用的 Agent">
        <Group>
          {status.profiles.map((id) => (
            <Row
              key={id}
              icon={
                <IconTile>
                  <SquareTerminal size={15} strokeWidth={1.75} />
                </IconTile>
              }
              title={<span className="selectable font-mono">{id}</span>}
            />
          ))}
          {status.profiles.length === 0 && (
            <Row
              icon={
                <IconTile tone="amber">
                  <TriangleAlert size={15} strokeWidth={1.75} />
                </IconTile>
              }
              title="没有可用的 Agent"
              description="请安装 DeepSeek Harness"
            />
          )}
        </Group>
      </Section>

      <Section title="模式">
        <Group>
          {MODES.map(({ mode, title, hint, icon: Icon }) => {
            const active = status.mode === mode;
            return (
              <label key={mode} className="block cursor-pointer hover:bg-hover">
                <input
                  type="radio"
                  name="mode"
                  className="peer sr-only"
                  checked={active}
                  disabled={busy}
                  onChange={() => void update({ mode })}
                />
                <Row
                  className="peer-focus-visible:bg-hover"
                  icon={
                    <IconTile tone={active ? "blue" : "gray"}>
                      <Icon size={15} strokeWidth={1.75} />
                    </IconTile>
                  }
                  title={title}
                  description={hint}
                  trailing={active ? <Check size={16} className="text-accent-text" /> : undefined}
                />
              </label>
            );
          })}
          {!MODES.some((m) => m.mode === status.mode) && (
            <div className="px-4 py-2.5 text-ink-muted text-sm">当前模式：{status.mode}</div>
          )}
        </Group>
      </Section>

      <Section title="电源">
        <Group>
          <Row
            icon={
              <IconTile>
                <MoonStar size={15} strokeWidth={1.75} />
              </IconTile>
            }
            title="防止休眠"
            description="有任务在跑时让电脑保持唤醒，合上盖子也能继续"
            trailing={
              <Switch
                label="防止休眠"
                checked={status.keepAwake}
                disabled={busy}
                onChange={(keepAwake) => void update({ keepAwake })}
              />
            }
          />
        </Group>
      </Section>

      <Section title="关于">
        <Group>
          <Row
            icon={
              <IconTile>
                <Rocket size={15} strokeWidth={1.75} />
              </IconTile>
            }
            title="重新运行引导"
            description="一步步绑定飞书、添加模型服务、给主管选模型"
            trailing={<Button onClick={openFirstRun}>打开引导</Button>}
          />
          <Row
            icon={
              <IconTile>
                <FolderOpen size={15} strokeWidth={1.75} />
              </IconTile>
            }
            title="数据目录"
            trailing={
              <span
                className="selectable block max-w-[420px] truncate font-mono text-ink-muted text-sm"
                title={status.home}
              >
                {status.home}
              </span>
            }
          />
          <Row
            icon={
              <IconTile>
                <Info size={15} strokeWidth={1.75} />
              </IconTile>
            }
            title="版本"
            trailing={
              <span className="selectable font-mono text-ink-muted text-sm">{status.version}</span>
            }
          />
        </Group>
      </Section>
    </div>
  );
}
