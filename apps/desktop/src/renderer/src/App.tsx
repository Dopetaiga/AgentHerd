// The app shell: a sidebar on the window frame, and the page on a rounded card beside it.

import { Boxes, ListTodo, Loader2, type LucideIcon, Settings, WifiOff } from "lucide-react";
import { useEffect } from "react";
import { Logo } from "./components/Logo";
import { Dot, Toasts } from "./components/ui";
import { FirstRun } from "./firstrun/FirstRun";
import { ModelsPage } from "./pages/ModelsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { type Page, startStore, useApp } from "./store";

const NAV: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: "tasks", label: "任务", icon: ListTodo },
  { page: "models", label: "模型", icon: Boxes },
  { page: "settings", label: "设置", icon: Settings },
];

const HEADERS: Record<Page, { title: string; hint: string }> = {
  tasks: { title: "任务", hint: "Agent 的进度，以及等你在飞书里处理的请求" },
  models: { title: "模型", hint: "给每个用途选一个模型，管理模型服务和 Key" },
  settings: { title: "设置", hint: "飞书、工作模式、电源和数据目录" },
};

function Sidebar() {
  const page = useApp((s) => s.page);
  const setPage = useApp((s) => s.setPage);
  const waiting = useApp((s) => s.tasks?.items.length ?? 0);
  const version = useApp((s) => s.status?.version);
  const connected = useApp((s) => s.connected);
  return (
    <aside className="flex w-(--ah-sidebar-width) shrink-0 flex-col">
      {/* The traffic lights of the hiddenInset title bar sit in this strip. */}
      <div className="app-drag h-(--ah-titlebar-height) shrink-0" />
      <div className="app-drag flex items-center gap-2.5 px-4 pt-1 pb-5">
        <Logo size={28} />
        <div className="min-w-0">
          <div className="font-semibold text-base text-ink tracking-[-0.1px]">AgentHerd</div>
          <div className="truncate text-ink-muted text-xs">在飞书里管理你的 Agent</div>
        </div>
      </div>
      <nav className="flex flex-col gap-px px-2.5">
        {NAV.map(({ page: p, label, icon: Icon }) => {
          const active = page === p;
          return (
            <button
              key={p}
              type="button"
              data-nav={p}
              aria-current={active ? "page" : undefined}
              onClick={() => setPage(p)}
              className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-md ${
                active
                  ? "bg-selected font-medium text-ink"
                  : "text-ink-2 hover:bg-hover hover:text-ink"
              }`}
            >
              <Icon
                size={16}
                strokeWidth={1.75}
                className={active ? "text-accent-text" : "text-ink-muted"}
              />
              <span className="flex-1">{label}</span>
              {p === "tasks" && waiting > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-1.5 font-semibold text-[11px] text-white">
                  {waiting}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto flex items-center gap-2 px-5 py-4 text-ink-muted text-sm">
        <Dot tone={connected ? "green" : "amber"} pulse={!connected} />
        <span className="flex-1">{connected ? "服务运行中" : "正在连接…"}</span>
        {version !== undefined && (
          <span className="font-mono text-ink-dim text-xs">v{version}</span>
        )}
      </div>
    </aside>
  );
}

function ConnectionBanner() {
  const connected = useApp((s) => s.connected);
  if (connected) return null;
  return (
    <div className="px-8 pb-3">
      <div className="mx-auto flex max-w-[760px] items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-md text-warning-text">
        <WifiOff size={14} />
        正在连接 AgentHerd 服务…
      </div>
    </div>
  );
}

function CurrentPage() {
  const page = useApp((s) => s.page);
  const loaded = useApp((s) => s.loaded);
  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-ink-muted text-md">
        <Loader2 size={16} className="animate-spin" />
        正在加载…
      </div>
    );
  }
  switch (page) {
    case "tasks":
      return <TasksPage />;
    case "models":
      return <ModelsPage />;
    case "settings":
      return <SettingsPage />;
  }
}

export function App() {
  const page = useApp((s) => s.page);
  const firstRun = useApp((s) => s.firstRun);
  const loaded = useApp((s) => s.loaded);
  useEffect(() => startStore(), []);
  const header = HEADERS[page];
  return (
    <>
      {/* Under the first run the shell stays in the DOM, hidden, so a click on a
          data-nav button (screenshot capture) still opens its page and closes the first run. */}
      <div
        className={`ah-frame flex h-full text-ink ${firstRun ? "invisible" : ""}`}
        aria-hidden={firstRun || undefined}
      >
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col pr-2 pb-2">
          <div className="app-drag h-2 shrink-0" />
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-canvas">
            <header className="app-drag flex min-h-[88px] shrink-0 flex-col justify-end px-8 pb-5">
              <div className="mx-auto w-full max-w-[760px]">
                <h1 className="font-semibold text-ink text-xl tracking-[-0.2px]">{header.title}</h1>
                <p className="mt-0.5 text-ink-muted text-md">{header.hint}</p>
              </div>
            </header>
            <ConnectionBanner />
            <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
              <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col">
                <CurrentPage />
              </div>
            </div>
          </main>
        </div>
      </div>
      {firstRun && loaded && <FirstRun />}
      <Toasts />
    </>
  );
}
