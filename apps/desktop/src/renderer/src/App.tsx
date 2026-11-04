// The app shell: sidebar navigation, connection banner, page, toasts.

import { Boxes, ListTodo, Loader2, type LucideIcon, Rocket, Settings, WifiOff } from "lucide-react";
import { useEffect } from "react";
import { Toasts } from "./components/ui";
import { ModelsPage } from "./pages/ModelsPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { needsOnboarding, type Page, startStore, useApp } from "./store";

const NAV: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: "onboarding", label: "引导", icon: Rocket },
  { page: "tasks", label: "任务", icon: ListTodo },
  { page: "models", label: "模型", icon: Boxes },
  { page: "settings", label: "设置", icon: Settings },
];

const TITLES: Record<Page, string> = {
  onboarding: "引导",
  tasks: "任务",
  models: "模型",
  settings: "设置",
};

function Sidebar() {
  const page = useApp((s) => s.page);
  const setPage = useApp((s) => s.setPage);
  const pending = useApp((s) => needsOnboarding(s.status, s.models));
  const waiting = useApp((s) => s.tasks?.items.length ?? 0);
  const version = useApp((s) => s.status?.version);
  return (
    <aside className="flex w-52 shrink-0 flex-col border-zinc-200 border-r bg-zinc-100/80 dark:border-zinc-800 dark:bg-zinc-900/80">
      <div className="app-drag h-12 shrink-0" />
      <div className="px-4 pb-4">
        <div className="font-semibold text-base text-zinc-900 dark:text-zinc-100">AgentHerd</div>
        <div className="text-xs text-zinc-500">在飞书里管理你的 Agent</div>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        {NAV.map(({ page: p, label, icon: Icon }) => (
          <button
            key={p}
            type="button"
            data-nav={p}
            onClick={() => setPage(p)}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
              page === p
                ? "bg-white font-medium text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
            }`}
          >
            <Icon size={16} className={page === p ? "text-blue-600 dark:text-blue-400" : ""} />
            <span className="flex-1">{label}</span>
            {p === "onboarding" && pending && (
              <span className="h-2 w-2 rounded-full bg-amber-500" />
            )}
            {p === "tasks" && waiting > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 font-medium text-[11px] text-white">
                {waiting}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="mt-auto px-4 py-3 text-xs text-zinc-400">
        {version !== undefined ? `v${version}` : ""}
      </div>
    </aside>
  );
}

function ConnectionBanner() {
  const connected = useApp((s) => s.connected);
  if (connected) return null;
  return (
    <div className="flex items-center gap-2 border-amber-200 border-b bg-amber-50 px-6 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <WifiOff size={14} />
      正在连接 AgentHerd 服务…
    </div>
  );
}

function CurrentPage() {
  const page = useApp((s) => s.page);
  const loaded = useApp((s) => s.loaded);
  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        <Loader2 size={16} className="mr-2 animate-spin" />
        正在加载…
      </div>
    );
  }
  switch (page) {
    case "onboarding":
      return <OnboardingPage />;
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
  useEffect(() => startStore(), []);
  return (
    <div className="flex h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="app-drag flex h-12 shrink-0 items-end px-8">
          <h1 className="font-semibold text-lg">{page === "onboarding" ? "" : TITLES[page]}</h1>
        </div>
        <ConnectionBanner />
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-4 pb-10">
          <CurrentPage />
        </div>
      </main>
      <Toasts />
    </div>
  );
}
