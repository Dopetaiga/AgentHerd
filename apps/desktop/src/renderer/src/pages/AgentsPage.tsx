// Agent: the coding agents the owner can start with /run, like OpenBot's provider list. Pi is
// downloaded by the app (pinned build, hash checked); DSH comes with the DeepSeek Harness app.

import type { AgentView } from "@agentherd/host/api";
import { CircleAlert, Download, Loader2, SquareTerminal, Trash2, X } from "lucide-react";
import { useState } from "react";
import { RoleSelect } from "../components/RolePicker";
import { Badge, Button, Group, IconTile, Section } from "../components/ui";
import { call, useApp } from "../store";

const DESCRIPTIONS: Record<string, string> = {
  dsh: "DeepSeek 的编程 Agent。每次写文件、联网都会先在飞书里问你。",
  pi: "轻量的开源编程 Agent。除了读任务目录里的文件，每次用工具都会先在飞书里问你。",
};

const SOURCES: Record<NonNullable<AgentView["source"]>, string> = {
  managed: "AgentHerd 下载的",
  system: "你电脑上装的",
  app: "随 DeepSeek Harness 安装",
  config: "config.json 里配置的",
};

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function StateBadge({ agent }: { agent: AgentView }) {
  switch (agent.state) {
    case "ready":
      return <Badge tone="green">可以用</Badge>;
    case "installing":
      return <Badge tone="blue">正在下载</Badge>;
    case "unsupported":
      return <Badge tone="gray">这台电脑不支持</Badge>;
    case "missing":
      return <Badge tone="amber">{agent.canInstall ? "未下载" : "未安装"}</Badge>;
  }
}

function Progress({ agent }: { agent: AgentView }) {
  const p = agent.progress;
  const percent = p !== undefined && p.total > 0 ? Math.round((p.received / p.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-control-hover">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-ink-muted text-sm">
        {p === undefined || p.total === 0
          ? "正在连接…"
          : `${megabytes(p.received)} / ${megabytes(p.total)}（${percent}%）`}
      </span>
    </div>
  );
}

function Actions({ agent }: { agent: AgentView }) {
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<AgentView[] | undefined>) => {
    setBusy(true);
    const agents = await fn();
    if (agents !== undefined) useApp.setState({ agents });
    setBusy(false);
  };
  if (agent.state === "installing") {
    return (
      <Button onClick={() => void act(() => call((h) => h.cancelInstall(agent.id)))}>
        <X size={13} />
        取消
      </Button>
    );
  }
  if (agent.canInstall) {
    return (
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => void act(() => call((h) => h.installAgent(agent.id)))}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        {agent.error === undefined ? "下载" : "重新下载"}
      </Button>
    );
  }
  if (agent.canRemove) {
    return (
      <Button
        disabled={busy}
        onClick={() => {
          if (window.confirm(`移除下载的 ${agent.name}？正在跑的任务不受影响，以后可以再下载。`))
            void act(() => call((h) => h.removeAgent(agent.id)));
        }}
      >
        <Trash2 size={13} />
        移除
      </Button>
    );
  }
  return null;
}

function detail(agent: AgentView): string {
  if (agent.state === "missing" && agent.id === "dsh")
    return "安装 DeepSeek Harness 桌面版后自动出现";
  if (agent.state === "missing" && agent.canInstall)
    return `约 ${megabytes(48_000_000)}，版本 ${agent.version ?? ""}`;
  if (agent.state === "ready" && agent.source !== undefined) {
    return `${SOURCES[agent.source]}${agent.source === "managed" ? `，版本 ${agent.version ?? ""}` : ""}`;
  }
  return "";
}

function AgentRow({ agent }: { agent: AgentView }) {
  const description = DESCRIPTIONS[agent.id];
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <IconTile tone={agent.state === "ready" ? "green" : "gray"}>
          <SquareTerminal size={15} strokeWidth={1.75} />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-medium text-ink text-md">
            {agent.name}
            <span className="font-mono font-normal text-ink-muted text-sm">/run {agent.id}</span>
            <StateBadge agent={agent} />
          </div>
          {description !== undefined && (
            <div className="mt-0.5 text-ink-2 text-sm">{description}</div>
          )}
          <div className="mt-0.5 text-ink-muted text-sm">{detail(agent)}</div>
          {agent.state === "ready" && agent.path !== undefined && agent.source !== "managed" && (
            <div className="selectable mt-0.5 truncate font-mono text-ink-muted text-xs">
              {agent.path}
            </div>
          )}
          {agent.state === "installing" && <Progress agent={agent} />}
          {agent.error !== undefined && agent.state !== "installing" && (
            <div className="mt-1 flex items-center gap-1.5 text-danger-text text-sm">
              <CircleAlert size={13} />
              下载失败：{agent.error}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Actions agent={agent} />
        </div>
      </div>
      {agent.id === "pi" && (
        <div className="mt-3 ml-10 flex items-center justify-between gap-3 border-line border-t pt-3">
          <div className="text-sm">
            <div className="text-ink">Pi 用的模型</div>
            <div className="text-ink-muted">从模型列表里选；不选就用 Pi 自己的登录和设置</div>
          </div>
          <RoleSelect modelRole="pi" label="Pi 的模型" className="w-56" />
        </div>
      )}
    </div>
  );
}

export function AgentsPage() {
  const agents = useApp((s) => s.agents);
  const ready = agents.filter((a) => a.state === "ready").length;
  return (
    <div className="flex flex-col gap-7">
      <Section
        title="编程 Agent"
        hint={ready === 0 ? "还没有可用的 Agent。下载 Pi 就能开始。" : `${ready} 个可以用`}
      >
        <Group>
          {agents.map((a) => (
            <AgentRow key={a.id} agent={a} />
          ))}
        </Group>
      </Section>
    </div>
  );
}
