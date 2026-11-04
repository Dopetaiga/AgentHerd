// 任务: the board (read only) and the open requests that wait for the owner in Feishu.

import { AlertTriangle, Bot, Inbox, ListTodo, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import {
  herderReasonLabel,
  hhmm,
  RISK_LABEL,
  STAGE_LABEL,
  STAGE_ORDER,
} from "../components/labels";
import { Badge, Card, EmptyState, SectionTitle } from "../components/ui";
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
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StripItem
          icon={<MessageSquare size={16} />}
          label="飞书"
          ok={channel.connected}
          value={channel.connected ? "已连接" : channel.bound ? "未连接" : "未绑定"}
          detail={channel.error}
        />
        <StripItem
          icon={<Bot size={16} />}
          label="主管"
          ok={herder.on}
          value={herder.on ? "工作中" : "已关闭"}
          detail={herder.on ? herder.ref : herderReasonLabel(herder.reason)}
        />
        <StripItem
          icon={<ListTodo size={16} />}
          label="可用 Agent"
          ok={profiles.length > 0}
          value={profiles.length > 0 ? profiles.join("、") : "无"}
        />
      </div>
      {profiles.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle size={14} />
          没有可用的 Agent：请安装 DeepSeek Harness
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
}: {
  icon: ReactNode;
  label: string;
  ok: boolean;
  value: string;
  detail?: string | undefined;
}) {
  return (
    <Card className="flex items-center gap-3 py-3">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
          ok
            ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-zinc-400"}`} />
          {label}
        </div>
        <div className="truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">{value}</div>
        {detail !== undefined && detail !== "" && (
          <div
            className={`selectable truncate text-xs ${ok ? "font-mono text-zinc-500" : "text-red-600 dark:text-red-400"}`}
            title={detail}
          >
            {detail}
          </div>
        )}
      </div>
    </Card>
  );
}

export function TasksPage() {
  const view = useApp((s) => s.tasks);
  const tasks = sortTasks(view?.tasks ?? []);
  const items = view?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <StatusStrip />

      <div>
        <SectionTitle hint="请在飞书里批准或拒绝">等你处理的请求</SectionTitle>
        <Card className="p-0">
          {items.length === 0 ? (
            <EmptyState icon={<Inbox size={28} />} text="没有等你处理的请求" />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {items.map((item) => {
                const risk = RISK_LABEL[item.risk];
                return (
                  <li key={item.id} className="flex flex-col gap-1.5 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
                        {item.title}
                      </span>
                      <Badge tone={risk.tone}>{risk.text}</Badge>
                      <span className="ml-auto shrink-0 text-xs text-zinc-500">
                        {hhmm(item.createdAt)}
                      </span>
                    </div>
                    <pre className="selectable truncate rounded bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
                      {item.body}
                    </pre>
                    {item.taskTitle !== undefined && (
                      <div className="truncate text-xs text-zinc-500">任务：{item.taskTitle}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div>
        <SectionTitle hint={tasks.length > 0 ? `${tasks.length} 个` : undefined}>任务</SectionTitle>
        <Card className="p-0">
          {tasks.length === 0 ? (
            <EmptyState
              icon={<ListTodo size={28} />}
              text={
                <>
                  还没有任务。在飞书里发 <code className="font-mono">/run</code> 开始一个任务。
                </>
              }
            />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {tasks.map((task) => {
                const stage = STAGE_LABEL[task.stage];
                return (
                  <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
                          {task.title}
                        </span>
                        <Badge tone={stage.tone}>{stage.text}</Badge>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                        <span className="truncate">{task.project}</span>
                        <span>·</span>
                        <span className="truncate">{task.agent}</span>
                      </div>
                      {task.lastReport !== "" && (
                        <div className="selectable mt-1 truncate text-sm text-zinc-600 dark:text-zinc-400">
                          {task.lastReport}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-zinc-500" title={task.updatedAt}>
                      {hhmm(task.updatedAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
