// 任务: the board (read only) and the open requests that wait for the owner in Feishu.

import { AlertTriangle, Bot, Inbox, ListTodo, MessageSquare, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import {
  canReconnect,
  channelErrorLabel,
  herderReasonLabel,
  hhmm,
  RISK_LABEL,
  STAGE_LABEL,
  STAGE_ORDER,
} from "../components/labels";
import { ReconnectButton } from "../components/ReconnectButton";
import { Badge, Dot, EmptyState, Group, IconTile, Section } from "../components/ui";
import { type Task, useApp } from "../store";

function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(
    (a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || b.updatedAt.localeCompare(a.updatedAt),
  );
}

function StatusStrip() {
  const status = useApp((s) => s.status);
  if (status === undefined) return null;
  const { channel, herder, profiles } = status;
  // A connect error gets the whole first row: the message is long and has a button.
  const retry = canReconnect(channel);
  const error = channel.error !== undefined && channel.error !== "";
  return (
    <div className="flex flex-col gap-3">
      <div className={`grid gap-3 ${retry ? "grid-cols-2" : "grid-cols-3"}`}>
        <StripItem
          className={retry ? "col-span-2" : ""}
          icon={<MessageSquare size={14} strokeWidth={1.75} />}
          label="飞书"
          ok={channel.connected}
          value={channel.connected ? "已连接" : channel.bound ? "未连接" : "未绑定"}
          detail={
            error
              ? channelErrorLabel(channel.error ?? "")
              : channel.bound
                ? undefined
                : "在「设置」里扫码绑定"
          }
          error={error}
          action={retry ? <ReconnectButton size="sm" /> : undefined}
        />
        <StripItem
          icon={<Bot size={14} strokeWidth={1.75} />}
          label="主管"
          ok={herder.on}
          value={herder.on ? "工作中" : "已关闭"}
          detail={herder.on ? herder.ref : herderReasonLabel(herder.reason)}
        />
        <StripItem
          icon={<ListTodo size={14} strokeWidth={1.75} />}
          label="可用 Agent"
          ok={profiles.length > 0}
          value={profiles.length > 0 ? profiles.join("、") : "无"}
        />
      </div>
      {profiles.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-md text-warning-text">
          <AlertTriangle size={14} />
          没有可用的 Agent：请先安装 DeepSeek Harness
        </div>
      )}
    </div>
  );
}

function StripItem({
  icon,
  label,
  ok,
  value,
  detail,
  error,
  action,
  className = "",
}: {
  className?: string;
  action?: ReactNode;
  icon: ReactNode;
  label: string;
  ok: boolean;
  value: string;
  detail?: string | undefined;
  error?: boolean;
}) {
  return (
    <div className={`min-w-0 rounded-card border border-line bg-surface px-4 py-3 ${className}`}>
      <div className="flex items-center gap-1.5 text-ink-muted text-sm">
        {icon}
        <span className="flex-1">{label}</span>
        <Dot tone={ok ? "green" : error === true ? "red" : "gray"} />
      </div>
      <div className="mt-1.5 truncate font-semibold text-base text-ink">{value}</div>
      <div
        className={`selectable mt-0.5 line-clamp-2 text-sm ${
          error === true ? "text-danger-text" : detail ? "text-ink-muted" : "text-ink-dim"
        }`}
        title={detail}
      >
        {detail === undefined || detail === "" ? (ok ? "一切正常" : "—") : detail}
      </div>
      {action !== undefined && <div className="mt-2.5">{action}</div>}
    </div>
  );
}

export function TasksPage() {
  const view = useApp((s) => s.tasks);
  const tasks = sortTasks(view?.tasks ?? []);
  const items = view?.items ?? [];

  return (
    <div className="flex flex-col gap-7">
      <StatusStrip />

      <Section
        title="等你处理"
        hint="这些请求已经发到飞书，请在飞书里批准或拒绝"
        actions={items.length > 0 ? <Badge tone="amber">{items.length} 个</Badge> : undefined}
      >
        <Group>
          {items.length === 0 ? (
            <EmptyState
              icon={<Inbox size={18} strokeWidth={1.75} />}
              title="没有等你处理的请求"
              text="Agent 需要你批准时，请求会出现在这里，也会发到飞书。"
            />
          ) : (
            items.map((item) => {
              const risk = RISK_LABEL[item.risk];
              return (
                <div key={item.id} className="flex gap-3 px-4 py-3">
                  <IconTile tone={item.risk === "high" ? "red" : "amber"}>
                    <ShieldAlert size={15} strokeWidth={1.75} />
                  </IconTile>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-ink">{item.title}</span>
                      <Badge tone={risk.tone}>{risk.text}</Badge>
                      <span className="ml-auto shrink-0 text-ink-muted text-sm tabular-nums">
                        {hhmm(item.createdAt)}
                      </span>
                    </div>
                    <pre className="selectable truncate rounded-md bg-inset px-2.5 py-1.5 font-mono text-ink-2 text-sm">
                      {item.body}
                    </pre>
                    {item.taskTitle !== undefined && (
                      <div className="truncate text-ink-muted text-sm">任务：{item.taskTitle}</div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </Group>
      </Section>

      <Section
        title="任务"
        actions={
          tasks.length > 0 ? (
            <span className="text-ink-muted text-sm">{tasks.length} 个</span>
          ) : undefined
        }
      >
        <Group>
          {tasks.length === 0 ? (
            <EmptyState
              icon={<ListTodo size={18} strokeWidth={1.75} />}
              title="还没有任务"
              text={
                <>
                  在飞书里给机器人发{" "}
                  <code className="rounded-xs bg-control-hover px-1 py-px font-mono text-ink-2 text-sm">
                    /run
                  </code>{" "}
                  开始一个任务。
                </>
              }
            />
          ) : (
            tasks.map((task) => {
              const stage = STAGE_LABEL[task.stage];
              return (
                <div key={task.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="flex h-[18px] items-center">
                    <Dot tone={stage.tone} pulse={task.stage === "working"} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-ink">{task.title}</span>
                      <Badge tone={stage.tone}>{stage.text}</Badge>
                      <span
                        className="ml-auto shrink-0 text-ink-muted text-sm tabular-nums"
                        title={task.updatedAt}
                      >
                        {hhmm(task.updatedAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-ink-muted text-sm">
                      <span className="truncate">{task.project}</span>
                      <span className="text-ink-dim">·</span>
                      <span className="truncate">{task.agent}</span>
                    </div>
                    {task.lastReport !== "" && (
                      <div className="selectable mt-1.5 truncate text-ink-2">{task.lastReport}</div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </Group>
      </Section>
    </div>
  );
}
