// App state: one zustand store fed by host calls, host events and a 5 s task poll.
// The renderer reaches the host only through `window.agentherd` (see src/shared/bridge.ts).

import type {
  HostApi,
  HostEvent,
  HostStatus,
  ModelsView,
  ProviderView,
  RemoteHost,
  SetupState,
  TasksView,
} from "@agentherd/host/api";
import { create } from "zustand";
import type { Bridge } from "../../shared/bridge";

// Core types, derived from the host API so the renderer depends on one package only.
export type Task = TasksView["tasks"][number];
export type ItemSummary = TasksView["items"][number];
export type ServiceView = ModelsView["services"][number];
export type ModelService = Parameters<HostApi["putService"]>[0];
export type ModelRole = Parameters<HostApi["chooseModel"]>[0];
export type ModelRef = NonNullable<Parameters<HostApi["chooseModel"]>[1]>;
export type Stage = Task["stage"];
export type Mode = HostStatus["mode"];

export type Page = "onboarding" | "tasks" | "models" | "settings";

export interface Toast {
  id: number;
  kind: "error" | "info";
  text: string;
}

interface AppState {
  connected: boolean;
  loaded: boolean;
  status: HostStatus | undefined;
  tasks: TasksView | undefined;
  models: ModelsView | undefined;
  providers: ProviderView[];
  setup: SetupState | undefined;
  page: Page;
  toasts: Toast[];
  setPage(page: Page): void;
  toast(text: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
}

const PAGES: readonly Page[] = ["onboarding", "tasks", "models", "settings"];

/** A page named in the URL hash (e.g. "#models"), for previews and reloads. */
function hashPage(): Page | undefined {
  const name = window.location.hash.slice(1);
  return PAGES.find((p) => p === name);
}

export const useApp = create<AppState>()((set, get) => ({
  connected: false,
  loaded: false,
  status: undefined,
  tasks: undefined,
  models: undefined,
  providers: [],
  setup: undefined,
  page: hashPage() ?? "tasks",
  toasts: [],
  setPage: (page) => set({ page }),
  toast: (text, kind = "error") => {
    const id = nextToastId++;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), 6000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

let nextToastId = 1;

export function bridge(): Bridge {
  return window.agentherd;
}

export function host(): RemoteHost {
  return window.agentherd.host;
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Runs a host call and shows a toast if it fails.
 * @returns The result, or undefined after an error.
 */
export async function call<T>(fn: (h: RemoteHost) => Promise<T>): Promise<T | undefined> {
  try {
    return await fn(host());
  } catch (error) {
    useApp.getState().toast(errorText(error));
    return undefined;
  }
}

/** Applies a models view returned by a host call. */
export function applyModels(models: ModelsView | undefined): void {
  if (models !== undefined) useApp.setState({ models });
}

/** True when onboarding is not finished: no Feishu binding or no Herder model. */
export function needsOnboarding(status: HostStatus | undefined, models: ModelsView | undefined) {
  if (status === undefined || models === undefined) return false;
  return !status.channel.bound || models.roles.herder === undefined;
}

function applyEvent(event: HostEvent): void {
  switch (event.topic) {
    case "status":
      useApp.setState({ status: event.data });
      break;
    case "tasks":
      useApp.setState({ tasks: event.data });
      break;
    case "models":
      useApp.setState({ models: event.data });
      break;
    case "setup":
      useApp.setState({ setup: event.data });
      if (event.data.phase === "connected") void refreshStatus();
      break;
  }
}

async function refreshStatus(): Promise<void> {
  try {
    useApp.setState({ status: await host().status() });
  } catch {
    // The connection banner explains failures; nothing else to do here.
  }
}

/** Loads everything from the host. Shows a toast on failure unless `quiet`. */
export async function loadAll(quiet = false): Promise<boolean> {
  try {
    const h = host();
    const [status, tasks, models, providers, setup] = await Promise.all([
      h.status(),
      h.tasks(),
      h.models(),
      h.providers(),
      h.setupState(),
    ]);
    const first = !useApp.getState().loaded;
    useApp.setState({ status, tasks, models, providers, setup, connected: true, loaded: true });
    if (first && hashPage() === undefined && needsOnboarding(status, models))
      useApp.setState({ page: "onboarding" });
    return true;
  } catch (error) {
    if (!quiet) useApp.getState().toast(errorText(error));
    return false;
  }
}

let started = false;

/** Connects the store to the bridge. Call once at startup. */
export function startStore(): void {
  if (started) return;
  started = true;
  const b = bridge();
  b.onEvent(applyEvent);
  b.onConnection((connected) => {
    const was = useApp.getState().connected;
    useApp.setState({ connected });
    if (connected && !was) void loadAll(true);
  });
  void loadAll(true);
  // Retry the first load until the host answers; events and the poll take over after that.
  const retry = setInterval(() => {
    if (useApp.getState().loaded) clearInterval(retry);
    else void loadAll(true);
  }, 2000);
  setInterval(() => {
    if (!useApp.getState().loaded) return;
    host()
      .tasks()
      .then((tasks) => useApp.setState({ tasks }))
      .catch(() => {
        // Poll failures are expected while the host restarts; the banner covers it.
      });
  }, 5000);
}
