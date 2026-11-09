// 设置: the Feishu channel, the owner's apps, mode, how the Herder talks, font size, keep awake, the first run, and where AgentHerd keeps
// its files.

import type { SettingsPatch } from "@agentherd/host/api";
import {
  Check,
  Eye,
  FolderOpen,
  Hand,
  Info,
  MessageCircle,
  MoonStar,
  Rocket,
  Type,
} from "lucide-react";
import { useState } from "react";
import { AppsSection } from "../components/AppsSection";
import { FeishuSection } from "../components/FeishuSection";
import { Button, Group, IconTile, Row, Section, Segmented, Switch } from "../components/ui";
import { FONT_SCALES, setFontScale, useFontScale } from "../font-scale";
import { HERDER_STYLE_LABELS } from "../herder-styles";
import { call, type Mode, useApp } from "../store";

const MODES: { mode: Mode; title: string; hint: string; icon: typeof Eye }[] = [
  { mode: "observe", title: "只观察", hint: "只建议，不自动批准", icon: Eye },
  { mode: "assist", title: "协助", hint: "按规则自动批准", icon: Hand },
];

export function SettingsPage() {
  const status = useApp((s) => s.status);
  const openFirstRun = useApp((s) => s.openFirstRun);
  const [busy, setBusy] = useState(false);
  const fontScale = useFontScale();

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
      <AppsSection />

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

      <Section title="主管的说话风格">
        <Group>
          {HERDER_STYLE_LABELS.map(({ style, title, hint }) => {
            const active = status.herderStyle === style;
            return (
              <label key={style} className="block cursor-pointer hover:bg-hover">
                <input
                  type="radio"
                  name="herderStyle"
                  className="peer sr-only"
                  checked={active}
                  disabled={busy}
                  onChange={() => void update({ herderStyle: style })}
                />
                <Row
                  className="peer-focus-visible:bg-hover"
                  icon={
                    <IconTile tone={active ? "blue" : "gray"}>
                      <MessageCircle size={15} strokeWidth={1.75} />
                    </IconTile>
                  }
                  title={title}
                  description={hint}
                  trailing={active ? <Check size={16} className="text-accent-text" /> : undefined}
                />
              </label>
            );
          })}
          <div className="px-4 py-2.5 text-ink-muted text-sm">随时可以换，也可以直接跟主管说</div>
        </Group>
      </Section>

      <Section title="外观">
        <Group>
          <Row
            icon={
              <IconTile>
                <Type size={15} strokeWidth={1.75} />
              </IconTile>
            }
            title="字体大小"
            description="整个界面的文字大小，只对这台电脑生效"
            trailing={
              <Segmented
                label="字体大小"
                options={FONT_SCALES}
                value={fontScale}
                onChange={setFontScale}
              />
            }
          />
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
